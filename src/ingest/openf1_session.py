"""
one session from OpenF1 (api.openf1.org) as the SessionTables FastF1 ingest writes, for when
F1's live timing archive is blocked (docs/pipeline-plan.md, Known constraints)

OpenF1 serves the same F1 timing feed after a session ends. It has no round number, no track
status, no session status and no deleted-lap flag, so this module derives them:
- the OpenF1 session is found by name and by the race date Jolpica gives for the round
- track and session status are rebuilt from race control flags and messages
- a lap is deleted when a "DELETED" message names its driver and its lap time
Every duration is seconds from ORIGIN before the scheduled start, standing in for FastF1's
stream start; race control keeps UTC, as in FastF1. Columns OpenF1 lacks (SpeedFL,
LapStartDate) stay empty, as they are in many FastF1 sessions.
A race classification comes from Jolpica, as FastF1's comes from Ergast, so it carries the
Ergast driver and constructor ids.
"""
import re
import time

import numpy as np
import pandas as pd
import requests

from src.sessions import SESSION_IDS, SessionTables

API = "https://api.openf1.org/v1/"
JOLPICA = "https://api.jolpi.ca/ergast/f1/"
ORIGIN = pd.Timedelta(minutes=30)
PACE_S = 0.5  # OpenF1's free tier allows a few requests a second
# Sprints are left out: on 2026 R17 (a wet start behind the safety car) OpenF1 had six more
# laps than FastF1 and a third of the lap times disagreed. The code below builds them like races
SUPPORTED = {"FP1", "FP2", "FP3", "Q", "SQ", "R"}
RACES = {"S", "R"}
NAMES = {sid: name for name, sid in SESSION_IDS.items() if name != "Sprint Shootout"}

DELETED_RE = re.compile(r"^CAR (\d+) \([A-Z]{3}\) TIME (\d+):(\d+\.\d+) DELETED - (.*?)(?:\d{2}:\d{2}:\d{2})?$")
REINSTATED_RE = re.compile(r"^CAR (\d+) \([A-Z]{3}\) TIME (\d+):(\d+\.\d+) .*REINSTATED")


class OpenF1NotAvailable(Exception):
    """OpenF1 has no finished data for this session yet; retry later"""


def _get(base: str, endpoint: str, **params) -> list | dict:
    """one request, retried on rate limits and gateway errors; OpenF1 answers 404 for no rows.
    Still refused after the retries is OpenF1NotAvailable, so the dispatcher retries next run"""
    for attempt in range(6):
        time.sleep(PACE_S)
        r = requests.get(base + endpoint, params=params, timeout=60)
        if r.status_code == 404 and base == API:
            return []
        if r.status_code in (429, 500, 502, 503, 504):
            wait = r.headers.get("Retry-After", "")
            time.sleep(float(wait) if wait.replace(".", "", 1).isdigit() else 2 * (attempt + 1))
            continue
        r.raise_for_status()
        return r.json()
    raise OpenF1NotAvailable(f"{base}{endpoint} still answers {r.status_code} after retries")


def _frame(endpoint: str, **params) -> pd.DataFrame:
    return pd.DataFrame(_get(API, endpoint, **params))


def _utc(s: pd.Series) -> pd.Series:
    """ISO strings -> naive UTC, the way FastF1 keeps race control times"""
    return pd.to_datetime(s, utc=True, format="ISO8601").dt.tz_localize(None)


def find_session(season: int, rnd: int, session_id: str) -> tuple[dict, list[dict]]:
    """the OpenF1 session for a round, and every session of its meeting
    OpenF1 has no round numbers, so the meeting is the one holding the round's race date"""
    race = _get(JOLPICA, f"{season}/{rnd}.json")["MRData"]["RaceTable"]["Races"]
    if not race:
        raise OpenF1NotAvailable(f"Jolpica has no {season} R{rnd}")
    race_date = race[0]["date"]
    races = [s for s in _get(API, "sessions", year=season, session_name="Race")
             if s["date_start"][:10] == race_date]
    if len(races) != 1:
        raise OpenF1NotAvailable(f"OpenF1 has {len(races)} races on {race_date}")
    meeting = _get(API, "sessions", meeting_key=races[0]["meeting_key"])
    match = [s for s in meeting if s["session_name"] == NAMES[session_id]]
    if len(match) != 1:
        raise OpenF1NotAvailable(f"OpenF1 has no {NAMES[session_id]} in meeting {races[0]['meeting_key']}")
    return match[0], meeting


def _track_status(rc: pd.DataFrame, t0: pd.Timestamp) -> pd.DataFrame:
    """FastF1's track status (1 clear, 2 yellow, 4 SC, 5 red, 6 VSC, 7 VSC ending), rebuilt
    from race control: yellow while any sector has a yellow, neutralisations from the
    SafetyCar messages, red from the red flag, all clear on a track-wide green or clear"""
    names = {"1": "AllClear", "2": "Yellow", "4": "SCDeployed", "5": "Red", "6": "VSCDeployed", "7": "VSCEnding"}
    rows, yellow, status = [(0.0, "1")], set(), "1"

    def to(t, new):
        nonlocal status
        t = max(t, 0.0)  # a message before ORIGIN still applies from the start, in order
        if new != status:
            status = new
            rows.append((t, new))

    for _, m in rc.iterrows():
        t = (m["date"] - t0).total_seconds()
        msg = m["message"] if isinstance(m["message"], str) else ""
        flag, scope = m["flag"], m["scope"]
        neutral = status in ("4", "5", "6", "7")
        if flag == "RED":
            to(t, "5")
        elif m["category"] == "SafetyCar" and "VIRTUAL" not in msg and "VSC" not in msg and "DEPLOYED" in msg:
            to(t, "4")
        elif m["category"] == "SafetyCar" and "DEPLOYED" in msg:
            to(t, "6")
        elif m["category"] == "SafetyCar" and "ENDING" in msg:
            to(t, "7")
        elif scope == "Sector" and flag in ("YELLOW", "DOUBLE YELLOW"):
            yellow.add(m["sector"])
            if not neutral:
                to(t, "2")
        elif scope == "Sector" and flag == "CLEAR":
            yellow.discard(m["sector"])
            if status == "2" and not yellow:
                to(t, "1")
        elif (scope == "Track" and flag in ("GREEN", "CLEAR")) or msg == "TRACK CLEAR":
            yellow.clear()
            to(t, "1")
    out = pd.DataFrame(rows, columns=["Time", "Status"])
    out["Message"] = out["Status"].map(names)
    return out


def _session_status(rc: pd.DataFrame, t0: pd.Timestamp, race: bool) -> pd.DataFrame:
    """Started at each green light, Aborted at a red flag, Finished at each chequered flag
    (one per qualifying segment); session_window reads the first Started and the last Finished.
    A race's green light opens the pit exit before the formation; it starts at "SESSION STARTED"
    (or "RESUMED" after a red flag)"""
    def started(m):
        if race:
            return m["category"] == "SessionStatus" and any(w in str(m["message"]) for w in ("STARTED", "RESUMED"))
        return m["flag"] == "GREEN" and m["scope"] == "Track"

    events = []
    for _, m in rc.iterrows():
        t = (m["date"] - t0).total_seconds()
        if started(m):
            events.append((t, "Started"))
        elif m["flag"] == "RED":
            events.append((t, "Aborted"))
        elif m["flag"] == "CHEQUERED":
            events.append((t, "Finished"))
    return pd.DataFrame(events, columns=["Time", "Status"])


def _lap_status(laps: pd.DataFrame, ts: pd.DataFrame) -> pd.Series:
    """every status active during the lap, in order, as FastF1 concatenates them ("12")"""
    times, codes = ts["Time"].to_numpy(), ts["Status"].to_numpy()

    def one(start, end):
        if np.isnan(start) or np.isnan(end):
            return np.nan
        first = max(np.searchsorted(times, start, side="right") - 1, 0)
        seen = [codes[first]]
        for c in codes[(times > start) & (times <= end)]:
            if c != seen[-1]:
                seen.append(c)
        return "".join(dict.fromkeys(seen))

    return pd.Series([one(s, e) for s, e in zip(laps["LapStartTime"], laps["Time"])], index=laps.index)


def _deletions(rc: pd.DataFrame) -> dict[tuple[str, float], str]:
    """(driver number, lap time) -> reason, for laps race control deleted and did not reinstate"""
    out = {}
    for msg in rc["message"].fillna(""):
        if m := DELETED_RE.match(msg):
            out[(m[1], round(int(m[2]) * 60 + float(m[3]), 3))] = m[4]
        elif m := REINSTATED_RE.match(msg):
            out.pop((m[1], round(int(m[2]) * 60 + float(m[3]), 3)), None)
    return out


def _laps(raw: pd.DataFrame, stints: pd.DataFrame, pits: pd.DataFrame, drivers: pd.DataFrame,
          rc: pd.DataFrame, ts: pd.DataFrame, t0: pd.Timestamp, positions: pd.DataFrame | None) -> pd.DataFrame:
    """FastF1's laps table. positions (OpenF1 position changes) is given for races only"""
    race = positions is not None
    laps = raw.sort_values(["driver_number", "lap_number"]).reset_index(drop=True)
    laps["DriverNumber"] = laps["driver_number"].astype(str)
    secs = lambda s: (_utc(s) - t0).dt.total_seconds()

    # OpenF1 starts a lap at its line crossing, or an out-lap at pit exit (else the pit row
    # of that lap). Outside races an out-lap's duration counts the time in the garage, so
    # FastF1 has no lap time for it and ends it where the next lap starts
    by_driver = laps["DriverNumber"]
    crossing = secs(laps["date_start"])
    if not pits.empty:
        exits = pits.assign(DriverNumber=pits["driver_number"].astype(str), t=secs(pits["date"]))
        exits = exits.groupby(["DriverNumber", "lap_number"])["t"].min()
        crossing = crossing.fillna(pd.Series([exits.get((d, n), np.nan) for d, n in
                                              zip(by_driver, laps["lap_number"])], index=laps.index))
    out_lap = laps["is_pit_out_lap"].fillna(False).astype(bool)
    last = laps["lap_number"] == laps.groupby("DriverNumber")["lap_number"].transform("max")
    # outside races the last lap is the drive back to the garage; a race ends at the flag
    in_lap = out_lap.groupby(by_driver).shift(-1, fill_value=False).astype(bool) | (last & ~race)

    duration = laps["lap_duration"].astype(float)
    if not race:
        duration = duration.where(~out_lap)
    sectors = laps[["duration_sector_1", "duration_sector_2", "duration_sector_3"]].astype(float)
    nxt = crossing.groupby(by_driver).shift(-1)
    end = (crossing + duration).fillna(nxt).fillna(crossing + sectors.sum(axis=1, min_count=3))
    end = end.fillna(crossing + sectors.sum(axis=1, min_count=1))
    # FastF1 starts every lap where the driver's previous lap ended, an out-lap included;
    # the first lap of the session starts at pit exit
    start = end.groupby(by_driver).shift(1).fillna(crossing)

    df = pd.DataFrame({
        "Time": end,
        "Driver": laps["DriverNumber"].map(drivers.set_index("DriverNumber")["Abbreviation"]),
        "DriverNumber": laps["DriverNumber"],
        "LapTime": duration,
        "LapNumber": laps["lap_number"].astype(float),
    })

    # tyres: the stint whose lap range holds the lap
    st = stints.assign(DriverNumber=stints["driver_number"].astype(str)) if not stints.empty else None
    stint, compound, life, fresh = [], [], [], []
    for d, n in zip(df["DriverNumber"], laps["lap_number"]):
        hit = st[(st["DriverNumber"] == d) & (st["lap_start"] <= n) & (st["lap_end"] >= n)] if st is not None else []
        if len(hit):
            s = hit.iloc[0]
            age = s["tyre_age_at_start"] if pd.notna(s["tyre_age_at_start"]) else np.nan
            stint.append(float(s["stint_number"]))
            compound.append(s["compound"] if s["compound"] else None)
            life.append(age + n - s["lap_start"] + 1)
            fresh.append(bool(age == 0))
        else:
            stint.append(np.nan); compound.append(None); life.append(np.nan); fresh.append(False)

    df["Stint"] = pd.Series(stint, index=df.index, dtype=float)
    df["PitOutTime"] = crossing.where(out_lap)
    df["PitInTime"] = end.where(in_lap)
    df["Sector1Time"] = sectors["duration_sector_1"]
    df["Sector2Time"] = sectors["duration_sector_2"]
    df["Sector3Time"] = sectors["duration_sector_3"]
    df["Sector1SessionTime"] = start + sectors["duration_sector_1"]
    df["Sector2SessionTime"] = end - sectors["duration_sector_3"]
    df["Sector3SessionTime"] = end.where(sectors["duration_sector_3"].notna())
    df["SpeedI1"] = laps["i1_speed"].astype(float)
    df["SpeedI2"] = laps["i2_speed"].astype(float)
    df["SpeedFL"] = np.nan
    df["SpeedST"] = laps["st_speed"].astype(float)

    deleted = _deletions(rc)
    reason = [deleted.get((d, round(t, 3))) if pd.notna(t) else None for d, t in zip(df["DriverNumber"], df["LapTime"])]
    df["Deleted"] = [r is not None for r in reason]
    timed = df["LapTime"].where(~df["Deleted"])
    best_before = timed.groupby(df["DriverNumber"]).transform(lambda s: s.cummin().shift(1))
    df["IsPersonalBest"] = (timed.notna() & (best_before.isna() | (timed < best_before))).astype(bool)
    df["Compound"] = compound
    df["TyreLife"] = pd.Series(life, index=df.index, dtype=float)
    df["FreshTyre"] = fresh
    df["Team"] = df["DriverNumber"].map(drivers.set_index("DriverNumber")["TeamName"])
    df["LapStartTime"] = start
    df["LapStartDate"] = pd.Series(pd.NaT, index=df.index, dtype="datetime64[us]")
    df["TrackStatus"] = _lap_status(df, ts)
    df["Position"] = _lap_positions(df, positions, t0) if race else np.nan
    df["DeletedReason"] = [r or "" for r in reason]
    df["FastF1Generated"] = False
    # a race's first lap starts from the grid, which FastF1 does not count as accurate timing
    df["IsAccurate"] = (df["LapTime"].notna() & ~out_lap & ~in_lap & ~(race & (df["LapNumber"] == 1))).astype(bool)
    return df[["Time", "Driver", "DriverNumber", "LapTime", "LapNumber", "Stint", "PitOutTime", "PitInTime",
               "Sector1Time", "Sector2Time", "Sector3Time", "Sector1SessionTime", "Sector2SessionTime",
               "Sector3SessionTime", "SpeedI1", "SpeedI2", "SpeedFL", "SpeedST", "IsPersonalBest", "Compound",
               "TyreLife", "FreshTyre", "Team", "LapStartTime", "LapStartDate", "TrackStatus", "Position",
               "Deleted", "DeletedReason", "FastF1Generated", "IsAccurate"]]


def _lap_positions(laps: pd.DataFrame, positions: pd.DataFrame, t0: pd.Timestamp) -> pd.Series:
    """each driver's running position when the lap ended, from OpenF1's position changes"""
    pos = positions.assign(DriverNumber=positions["driver_number"].astype(str),
                           t=(_utc(positions["date"]) - t0).dt.total_seconds())[["DriverNumber", "t", "position"]]
    ends = laps[["DriverNumber", "Time"]].reset_index().dropna(subset=["Time"])
    hit = pd.merge_asof(ends.sort_values("Time"), pos.sort_values("t"), left_on="Time", right_on="t",
                        by="DriverNumber", direction="backward")
    return hit.set_index("index")["position"].reindex(laps.index).astype(float)


def _gap_s(text: str) -> float:
    """Jolpica's "+7.335" or "+1:21.666" in seconds; anything else (laps, empty) is NaN"""
    if m := re.fullmatch(r"\+(?:(\d+):)?(\d+\.\d+)", text or ""):
        return int(m[1] or 0) * 60 + float(m[2])
    return np.nan


def _classification(season: int, rnd: int, session_id: str) -> pd.DataFrame:
    """the official race or sprint result from Jolpica, in FastF1's columns, by car number:
    Time is the winner's race time and every other car's gap to the winner"""
    path, key = ("results", "Results") if session_id == "R" else ("sprint", "SprintResults")
    races = _get(JOLPICA, f"{season}/{rnd}/{path}.json", limit=100)["MRData"]["RaceTable"]["Races"]
    rows = races[0].get(key, []) if races else []
    if not rows:
        raise OpenF1NotAvailable(f"Jolpica has no {season} R{rnd} {session_id} result yet")
    out = pd.DataFrame({
        "DriverNumber": [r["number"] for r in rows],
        "DriverId": [r["Driver"]["driverId"] for r in rows],
        "TeamId": [r["Constructor"]["constructorId"] for r in rows],
        "Position": [float(r["position"]) for r in rows],
        "ClassifiedPosition": [r["positionText"] for r in rows],
        "GridPosition": [float(r["grid"]) for r in rows],
        "Time": [float(r["Time"]["millis"]) / 1000 if r["position"] == "1" and "Time" in r
                 else _gap_s(r.get("Time", {}).get("time", "")) for r in rows],
        "Status": [r["status"] for r in rows],
        "Points": [float(r["points"]) for r in rows],
        "Laps": [float(r["laps"]) for r in rows],
    })
    return out.set_index("DriverNumber")


def _segment_times(res: pd.DataFrame, laps: pd.DataFrame, status: pd.DataFrame) -> pd.DataFrame:
    """Q1-Q3 per driver. OpenF1's segment best also counts laps that do not count: deleted by
    race control, or completed under a red flag. Such a time is replaced by the driver's best
    counting lap of that segment (a lap belongs to the segment whose chequered flag follows its start)"""
    times = pd.DataFrame({q: res["duration"].map(lambda d: d[i] if isinstance(d, list) and len(d) > i else None)
                          for i, q in enumerate(["Q1", "Q2", "Q3"])}, index=res.index).astype(float)
    flags = np.sort(status.loc[status["Status"] == "Finished", "Time"].to_numpy())
    segment = np.searchsorted(flags, laps["LapStartTime"].to_numpy(), side="left")
    counts = ~laps["Deleted"] & laps["LapTime"].notna() & ~laps["TrackStatus"].fillna("").str.contains("5")
    kept = laps.assign(segment=segment)[counts]
    best = kept.groupby(["DriverNumber", "segment"])["LapTime"].min()
    valid = set(zip(kept["DriverNumber"], kept["LapTime"].round(3)))
    for i, q in enumerate(times.columns):
        for d, t in times[q].items():
            if pd.notna(t) and (d, round(t, 3)) not in valid:
                times.loc[d, q] = best.get((d, i), np.nan)
    return times


def _classify(res: pd.DataFrame, times: pd.DataFrame) -> pd.Series:
    """qualifying order: drivers who reached a later segment first, then by their time in the
    last segment they reached; OpenF1's own order (codes such as "RT" last) breaks ties"""
    reached = res["duration"].map(lambda d: sum(x is not None for x in d) if isinstance(d, list) else 0)
    last = pd.Series([times.loc[d].iloc[r - 1] if r else np.nan for d, r in reached.items()], index=res.index)
    openf1 = pd.Series(np.arange(len(res)), index=res.index)
    order = pd.DataFrame({"reached": -reached, "time": last.fillna(np.inf), "openf1": openf1})
    ranked = order.sort_values(["reached", "time", "openf1"]).index
    return pd.Series(np.arange(1, len(ranked) + 1, dtype=float), index=ranked)


def _results(drivers: pd.DataFrame, result: pd.DataFrame, session_id: str,
             laps: pd.DataFrame, status: pd.DataFrame, classification: pd.DataFrame | None) -> pd.DataFrame:
    """FastF1's results: entrants from the drivers list; position and Q1-Q3 for qualifying, the
    Jolpica classification for races. Elsewhere Ergast ids stay empty, as FastF1 leaves them
    until Ergast publishes the round"""
    df = drivers.copy()
    for c in ["Position", "GridPosition", "Q1", "Q2", "Q3", "Time", "Points", "Laps"]:
        df[c] = np.nan
    df["ClassifiedPosition"] = ""
    df["Status"] = ""
    if session_id in ("Q", "SQ") and not result.empty:
        res = result.assign(DriverNumber=result["driver_number"].astype(str)).set_index("DriverNumber")
        times = _segment_times(res, laps, status)
        df["Position"] = df["DriverNumber"].map(_classify(res, times)).astype(float)
        for q in times.columns:
            df[q] = df["DriverNumber"].map(times[q]).astype(float)
    if classification is not None:
        for c in classification.columns:
            mapped = df["DriverNumber"].map(classification[c])
            df[c] = mapped.astype(float) if classification[c].dtype == float else mapped.fillna(df[c])
    return df[["DriverNumber", "BroadcastName", "Abbreviation", "DriverId", "TeamName", "TeamColor", "TeamId",
               "FirstName", "LastName", "FullName", "HeadshotUrl", "CountryCode", "Position", "ClassifiedPosition",
               "GridPosition", "Q1", "Q2", "Q3", "Time", "Status", "Points", "Laps"]]


def _drivers(raw: pd.DataFrame) -> pd.DataFrame:
    d = raw.drop_duplicates("driver_number")
    return pd.DataFrame({
        "DriverNumber": d["driver_number"].astype(str),
        "BroadcastName": d["broadcast_name"].fillna(""),
        "Abbreviation": d["name_acronym"],
        "DriverId": "",
        "TeamName": d["team_name"].fillna(""),
        "TeamColor": d["team_colour"].fillna(""),
        "TeamId": "",
        "FirstName": d["first_name"].fillna(""),
        "LastName": d["last_name"].fillna(""),
        "FullName": (d["first_name"].fillna("") + " " + d["last_name"].fillna("")).str.strip(),
        "HeadshotUrl": d["headshot_url"].fillna(""),
        "CountryCode": d["country_code"].fillna(""),
    }).reset_index(drop=True)


def load_session(season: int, rnd: int, session_id: str) -> SessionTables:
    """one finished session from OpenF1; raises OpenF1NotAvailable until OpenF1 has it in full"""
    if session_id not in SUPPORTED:
        raise OpenF1NotAvailable(f"the OpenF1 fallback does not build {session_id}, only {sorted(SUPPORTED)}")
    session, meeting = find_session(season, rnd, session_id)
    key = session["session_key"]
    scheduled = pd.Timestamp(session["date_start"]).tz_convert("UTC").tz_localize(None)
    t0 = scheduled - ORIGIN

    pending = f"OpenF1 does not have all of {season} R{rnd} {session_id} (session {key}) yet"
    if pd.Timestamp.now(tz="UTC") < pd.Timestamp(session["date_end"]):
        raise OpenF1NotAvailable(f"{pending}: it ends {session['date_end']}")
    rc = _frame("race_control", session_key=key)
    # qualifying has a chequered flag per segment
    flags_needed = 3 if session_id in ("Q", "SQ") else 1
    if rc.empty or (rc["flag"] == "CHEQUERED").sum() < flags_needed:
        raise OpenF1NotAvailable(f"{pending}: race control has no final chequered flag")
    rc["date"] = _utc(rc["date"])
    rc = rc.sort_values("date", kind="stable").reset_index(drop=True)

    # every endpoint must be filled, or tyres, weather or the classification would go missing quietly
    frames = {e: _frame(e, session_key=key) for e in ["laps", "drivers", "stints", "pit", "weather", "session_result"]}
    needed = ["laps", "drivers", "stints", "weather"] + (["session_result"] if session_id in ("Q", "SQ") else [])
    if empty := [e for e in needed if frames[e].empty]:
        raise OpenF1NotAvailable(f"{pending}: {', '.join(empty)} empty")
    if frames["stints"]["compound"].isna().all():
        raise OpenF1NotAvailable(f"{pending}: stints have no compounds")
    raw_laps, stints, pits = frames["laps"], frames["stints"], frames["pit"]
    weather_raw, result = frames["weather"], frames["session_result"]
    drivers = _drivers(frames["drivers"])

    ts = _track_status(rc, t0)
    weather = pd.DataFrame({
        "Time": (_utc(weather_raw["date"]) - t0).dt.total_seconds(),
        "AirTemp": weather_raw["air_temperature"].astype(float),
        "Humidity": weather_raw["humidity"].astype(float),
        "Pressure": weather_raw["pressure"].astype(float),
        "Rainfall": weather_raw["rainfall"].fillna(0).astype(bool),
        "TrackTemp": weather_raw["track_temperature"].astype(float),
        "WindDirection": weather_raw["wind_direction"].fillna(0).astype("int64"),
        "WindSpeed": weather_raw["wind_speed"].astype(float),
    }).sort_values("Time").reset_index(drop=True)

    # FastF1 has no SessionStatus category: those messages feed its session status instead
    messages = rc[rc["category"] != "SessionStatus"]
    race_control = pd.DataFrame({
        "Time": messages["date"].astype("datetime64[us]"),
        "Category": messages["category"],
        "Message": messages["message"],
        "Status": None,
        "Flag": messages["flag"],
        "Scope": messages["scope"],
        "Sector": messages["sector"].astype(float),
        "RacingNumber": messages["driver_number"].map(lambda n: str(int(n)) if pd.notna(n) else None),
        "Lap": messages["lap_number"].astype("Int64"),
    }).reset_index(drop=True)

    race = session_id in RACES
    classification = _classification(season, rnd, session_id) if race else None
    positions = _frame("position", session_key=key) if race else None
    if race and positions.empty:
        raise OpenF1NotAvailable(f"{pending}: position empty")

    sprint = any(s["session_name"] == "Sprint" for s in meeting)
    laps = _laps(raw_laps, stints, pits, drivers, rc, ts, t0, positions)
    status = _session_status(rc, t0, race)
    return SessionTables(
        season=season,
        round=rnd,
        session=NAMES[session_id],
        event_format="sprint_qualifying" if sprint else "conventional",
        date=scheduled,
        laps=laps,
        results=_results(drivers, result, session_id, laps, status, classification),
        weather=weather,
        track_status=ts,
        session_status=status,
        race_control=race_control,
    )
