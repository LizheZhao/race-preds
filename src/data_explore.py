from collections.abc import Callable, Iterable

import pandas as pd
import numpy as np
import fastf1
from fastf1.ergast import Ergast
from fastf1.ergast.interface import ErgastMultiResponse
import src.session as session_utils


def establish_api(limit=100):
    """jolpica caps a page at 100 rows"""
    return Ergast(limit=limit)


def collect_pages(fetch: Callable[..., ErgastMultiResponse], **filters) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    request every page of a multi-response Ergast endpoint and stack them
      results: one row per content row, tagged with season and round
      races:   one row per race (description), deduplicated

    pages are cut by row count, not by race, so one race can straddle two pages;
    its description then appears on both pages and is deduplicated here
    works for any ErgastMultiResponse endpoint (results, pit stops, standings, ...)
    """
    contents, descriptions = [], []
    page = fetch(**filters)
    while True:
        for content, (_, race) in zip(page.content, page.description.iterrows()):
            contents.append(content.assign(season=race["season"], round=race["round"]))
        descriptions.append(page.description)
        # is_complete is False on every page after the first, so page on until the end
        try:
            page = page.get_next_result_page()
        except ValueError:
            break

    if not contents:
        return pd.DataFrame(), pd.DataFrame()
    # drop all-empty columns per page before stacking so pandas infers dtypes from real values
    results = pd.concat([c.dropna(axis=1, how="all") for c in contents], ignore_index=True)
    races = pd.concat(descriptions, ignore_index=True).drop_duplicates(["season", "round"])
    assert len(results) == page.total_results, "rows lost while paging"
    return results, races.reset_index(drop=True)


def get_season_results(year: int, kind: str = "race") -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    results and race info for one season
    kind: "race", "sprint", "qualifying" (see RESULT_ENDPOINTS) or "sprint_qualifying"
    """
    # Ergast result endpoints
    # Sprint qualifying is not in Ergast derive it from the FastF1 session instead
    RESULT_ENDPOINTS = {
        "race": "get_race_results",
        "sprint": "get_sprint_results",
        "qualifying": "get_qualifying_results",
    }
    if kind not in [*RESULT_ENDPOINTS, 'sprint_qualifying']:
        raise ValueError(f"unknown kind {kind!r}, expected one of {[*RESULT_ENDPOINTS, 'sprint_qualifying']}")

    if kind == "sprint_qualifying":
        return _sprint_qualifying_from_fastf1(year)
    else:
        api = establish_api()
        fetch = getattr(api, RESULT_ENDPOINTS[kind])
        results, races = collect_pages(fetch, season=year)
        return results.assign(session=kind), races


def _sprint_qualifying_from_fastf1(year: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    sprint qualifying results for one season, in the same shape as Ergast qualifying
    called through get_season_results(year, "sprint_qualifying")

    Ergast has no sprint qualifying, so this loads each SQ session from FastF1, which
    classifies it from lap times by SQ1/SQ2/SQ3 elimination. That needs laps and race
    control messages (for the segment split); without messages Position comes back empty.
    Ergast ids are mapped from the same round's sprint results.
    Drivers who set no time get NaN from FastF1; they are placed at the back
    (position_imputed = True) so every entrant has a position, as in Ergast.
    """
    sprint, races = get_season_results(year, "sprint")
    if sprint.empty:
        return pd.DataFrame(), races

    ids = sprint[["round", "driverCode", "driverId", "constructorId", "constructorName"]]
    rounds = []
    for rnd in sorted(sprint["round"].unique()):
        sq_name = next((s["session_name"] for s in session_utils.get_sessions(year, int(rnd)) if s["session_id"] == "SQ"), None)
        if sq_name is None:
            continue
        session = fastf1.get_session(year, int(rnd), sq_name)
        session.load(laps=True, telemetry=False, weather=False, messages=True)
        res = session.results.rename(columns={
            "Abbreviation": "driverCode",
            "DriverNumber": "driverNumber",
            "Position": "position",
        })[["driverCode", "driverNumber", "position", "Q1", "Q2", "Q3"]].copy()

        # no-time drivers go to the back, in the order FastF1 lists them
        res["position_imputed"] = res["position"].isna()
        n_timed = int(res["position"].notna().sum())
        res.loc[res["position_imputed"], "position"] = range(n_timed + 1, len(res) + 1)
        res["position"] = res["position"].astype(int)
        res["driverNumber"] = res["driverNumber"].astype(int)  # FastF1 uses strings, Ergast ints

        res["round"] = int(rnd)
        rounds.append(res.sort_values("position"))

    results = pd.concat(rounds, ignore_index=True)
    results = results.merge(ids, on=["round", "driverCode"], how="left")
    results["season"] = year
    return results.assign(session="sprint_qualifying"), races


def get_results(years: Iterable[int], kind: str = "race") -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    get_season_results over several seasons, stacked
    FastF1 throttles to 4 calls/s and raises after 500 uncached calls/h; responses are
    cached, so an interrupted backfill can simply be rerun
    """
    all_results, all_races = [], []
    for year in years:
        results, races = get_season_results(year, kind)
        all_results.append(results)
        all_races.append(races)
    return pd.concat(all_results, ignore_index=True), pd.concat(all_races, ignore_index=True)

# ---------------------------------------------------------------------------
# Per-session summaries
# ---------------------------------------------------------------------------

# Race control message patterns. Driver abbreviations always appear as "(ABC)"
ABBR_RE = r"\(([A-Z]{3})\)"
TRACK_LIMITS_RE = r"^CAR \d+ \([A-Z]{3}\) (?:TIME \S+ |LAP )DELETED - TRACK LIMITS"
PENALTY_RE = r"PENALTY FOR CAR"
RAIN_RISK_RE = r"RISK OF RAIN.*?(\d+)\s*%"


def _seconds(values: pd.Series) -> pd.Series:
    """timedelta -> float seconds, NaT -> NaN"""
    return values.dt.total_seconds()


def session_window(session) -> tuple[pd.Timedelta, pd.Timedelta]:
    """
    first "Started" to last "Finished" in session time
    """
    status = session.session_status
    start = status.loc[status["Status"] == "Started", "Time"].min()
    end = status.loc[status["Status"] == "Finished", "Time"].max()
    if pd.isna(start):
        start = pd.Timedelta(0)
    if pd.isna(end):
        end = session.laps["Time"].max()
    return start, end


def _track_status_summary(session, start: pd.Timedelta, end: pd.Timedelta) -> dict:
    """
    count and minutes of yellow / SC / red / VSC inside the session window

    counting rule (the race_incidents label definition):
      every status period active at any point inside the window counts, including one
      that began before the start (a wet start behind the SC counts as one SC)
      SC -> red flag -> SC counts as two SC periods and one red flag
    """

    TRACK_STATUS_NAMES = {"2": "yellow", "4": "sc", "5": "red", "6": "vsc"}

    ts = session.track_status[["Time", "Status"]].copy()

    # each row lasts until the next change; the last one until the session ends
    ts["End"] = ts["Time"].shift(-1).fillna(end)
    ts["Time"] = ts["Time"].clip(lower=start, upper=end)
    ts["End"] = ts["End"].clip(lower=start, upper=end)
    ts["minutes"] = _seconds(ts["End"] - ts["Time"]) / 60
    ts["new_episode"] = ts["Status"].ne(ts["Status"].shift())

    out = {}
    for code, name in TRACK_STATUS_NAMES.items():
        inside = ts[(ts["Status"] == code) & (ts["minutes"] > 0)]
        out[f"{name}_n"] = int(inside["new_episode"].sum())
        out[f"{name}_min"] = inside["minutes"].sum()

    # "7" = VSC ending, still neutralised running
    out["vsc_min"] += ts.loc[ts["Status"] == "7", "minutes"].sum()
    return out


def _weather_summary(session, start: pd.Timedelta, end: pd.Timedelta) -> dict:
    """weather averaged over the minutes the session was actually running"""
    weather = session.weather_data
    inside = weather[(weather["Time"] >= start) & (weather["Time"] <= end)]
    if inside.empty:
        inside = weather
    return {
        "air_temp_mean": inside["AirTemp"].mean(),
        "track_temp_mean": inside["TrackTemp"].mean(),
        "track_temp_min": inside["TrackTemp"].min(),
        "track_temp_max": inside["TrackTemp"].max(),
        "humidity_mean": inside["Humidity"].mean(),
        "wind_speed_mean": inside["WindSpeed"].mean(),
        "rain_frac": inside["Rainfall"].astype(bool).mean(),
    }


def _race_control_by_driver(session) -> pd.DataFrame:
    """per-driver counts of track limits, incidents, investigations, penalties, flags"""

    rc = session.race_control_messages
    msg = rc["Message"].fillna("")

    # a message can name several cars, so explode to one row per (message, driver)
    events = {
        "track_limits_n": msg.str.contains(TRACK_LIMITS_RE),
        "incidents_n": msg.str.contains("INCIDENT INVOLVING") & msg.str.contains("NOTED"),
        "investigations_n": msg.str.contains("UNDER INVESTIGATION|WILL BE INVESTIGATED"),
        "penalties_n": msg.str.contains(PENALTY_RE) & ~msg.str.contains("SERVED"),
        "blue_flags_n": rc["Flag"] == "BLUE",
        "black_white_flags_n": rc["Flag"] == "BLACK AND WHITE",
    }
    counts = []
    for name, mask in events.items():
        drivers = msg[mask].str.findall(ABBR_RE).explode().dropna()
        counts.append(drivers.value_counts().rename(name))
    return pd.concat(counts, axis=1).fillna(0).astype(int)


def _race_control_summary(session) -> dict:
    """session-wide race control counts, plus the pre-race rain risk if announced"""
    msg = session.race_control_messages["Message"].fillna("")
    rain_risk = msg.str.extract(RAIN_RISK_RE)[0].dropna().astype(float)
    return {
        "incidents_n": int((msg.str.contains("INCIDENT INVOLVING") & msg.str.contains("NOTED")).sum()),
        "penalties_n": int((msg.str.contains(PENALTY_RE) & ~msg.str.contains("SERVED")).sum()),
        "track_limits_n": int(msg.str.contains(TRACK_LIMITS_RE).sum()),
        "rain_risk_pct": rain_risk.iloc[-1] if len(rain_risk) else np.nan,
    }


def _driver_lap_features(laps, start: pd.Timedelta) -> pd.DataFrame:
    """one row per driver: pace, sectors, top speed, mileage, tyres, consistency"""
    driven = laps[~laps["FastF1Generated"]].copy()
    driven["Compound"] = driven["Compound"].astype(str).replace({"nan": "UNKNOWN", "None": "UNKNOWN"})
    timed = driven.pick_not_deleted()

    feats = pd.DataFrame(index=pd.Index(sorted(driven["Driver"].unique()), name="Driver"))
    feats["team"] = driven.groupby("Driver")["Team"].first()
    feats = feats.join(timed.groupby("Driver").agg(
        best_lap=("LapTime", "min"),
        best_s1=("Sector1Time", "min"),
        best_s2=("Sector2Time", "min"),
        best_s3=("Sector3Time", "min"),
        top_speed_st=("SpeedST", "max"),
    ))
    for col in ["best_lap", "best_s1", "best_s2", "best_s3"]:
        feats[col] = _seconds(feats[col])
    feats["ideal_lap"] = feats[["best_s1", "best_s2", "best_s3"]].sum(axis=1, min_count=3)

    # mileage counts deleted laps too, they were still driven
    feats["laps_driven"] = driven.groupby("Driver").size()
    compound_laps = driven.groupby(["Driver", "Compound"]).size().unstack(fill_value=0)
    compound_laps.columns = [f"laps_{c.lower()}" for c in compound_laps.columns]
    feats = feats.join(compound_laps)

    # best lap on softs: the closest thing to quali sim
    feats["best_lap_soft"] = _seconds(
        timed[timed["Compound"] == "SOFT"].groupby("Driver")["LapTime"].min()
    )

    # when the best lap happened, minutes into the session (late = low fuel / evolved track)
    best_rows = timed.dropna(subset=["LapTime"]).sort_values("LapTime").drop_duplicates("Driver")
    feats["best_lap_at_min"] = _seconds(best_rows.set_index("Driver")["LapStartTime"] - start) / 60

    # clean green-flag laps for pace and consistency
    clean = timed.pick_wo_box().pick_track_status("1").pick_accurate().pick_quicklaps()
    clean_s = _seconds(clean["LapTime"]).groupby(clean["Driver"])
    feats["clean_laps"] = clean_s.size()
    feats["clean_lap_median"] = clean_s.median()
    feats["clean_lap_std"] = clean_s.std()

    # comparable across circuits: gaps in % to the session / team best, and ranks
    feats["best_lap_gap_pct"] = (feats["best_lap"] / feats["best_lap"].min() - 1) * 100
    feats["ideal_lap_gap_pct"] = (feats["ideal_lap"] / feats["ideal_lap"].min() - 1) * 100
    feats["team_gap_pct"] = (feats["best_lap"] / feats.groupby("team")["best_lap"].transform("min") - 1) * 100
    feats["best_lap_rank"] = feats["best_lap"].rank(method="min")
    feats["top_speed_rank"] = feats["top_speed_st"].rank(method="min", ascending=False)
    return feats


def summarize_session(session) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    summarize one loaded session into
      by_driver:   one row per driver (laps, pace, tyres, race control)
      session_row: one row for the session (window, weather, track status, race control)

    session must be loaded with laps, weather and messages, e.g.
      session.load(laps=True, telemetry=False, weather=True, messages=True)
    works for practice, qualifying, sprint and race; session-type specific
    features (quali position, grid, stints, pit stops) are added separately
    """
    if session.laps["Deleted"].isna().all():
        raise ValueError("load the session with messages=True, lap deletions come from race control")

    keys = {
        "season": int(session.event.year),
        "round": int(session.event["RoundNumber"]),
        "session": session.name,
    }
    start, end = session_window(session)

    # per driver: lap features + race control counts, keyed by Ergast driverId as well
    by_driver = _driver_lap_features(session.laps, start)
    by_driver = by_driver.join(_race_control_by_driver(session))
    # outer join keeps entrants with no laps (e.g. out on lap 1); DriverId is empty
    # for sessions Ergast does not cover, such as sprint qualifying
    ids = session.results.set_index("Abbreviation")[["DriverNumber", "DriverId"]].copy()
    ids["DriverId"] = ids["DriverId"].where(ids["DriverId"] != "")
    by_driver = ids.join(by_driver, how="outer").rename_axis("Driver").reset_index()

    # counts are 0, not missing, for drivers with no laps or no messages
    count_cols = [c for c in by_driver.columns if c.startswith("laps_") or c.endswith("_n")]
    by_driver[count_cols] = by_driver[count_cols].fillna(0).astype(int)
    by_driver = by_driver.assign(**keys)[list(keys) + [c for c in by_driver.columns]]

    # per session: timing window, weather, track status, race control
    laps = session.laps
    session_row = {
        **keys,
        "event_format": session.event["EventFormat"],
        "duration_min": _seconds(pd.Series([end - start])).iloc[0] / 60,
        "drivers_n": laps["Driver"].nunique(),
        "wet_laps_frac": laps["Compound"].isin(["INTERMEDIATE", "WET"]).mean(),
        **_weather_summary(session, start, end),
        **_track_status_summary(session, start, end),
        **_race_control_summary(session),
    }
    return by_driver, pd.DataFrame([session_row])


# ---------------------------------------------------------------------------
# Per-session timeline
# ---------------------------------------------------------------------------

def _session_t0_date(session, start: pd.Timedelta, end: pd.Timedelta) -> pd.Timestamp:
    """
    UTC timestamp of session time 0, best source first:
      1. lap dates vs lap times (only filled when telemetry is loaded)
      2. the chequered flag message (UTC) vs the last "Finished" (session time);
         within ~2 s of 1. on 2025 test sessions
      3. the scheduled start; minutes off for races (formation lap, delays), last resort
    """
    laps = session.laps
    offset = (laps["LapStartDate"] - laps["LapStartTime"]).dropna()
    if len(offset):
        return offset.median()

    rc = session.race_control_messages
    chequered = rc.loc[rc["Flag"] == "CHEQUERED", "Time"]
    if len(chequered) and pd.notna(end):
        return chequered.max() - end
    return session.date - start


def _bin_index(times: pd.Series, start: pd.Timedelta, step: pd.Timedelta) -> pd.Series:
    """which timeline row (0, 1, 2, ...) each session time falls into"""
    return ((times - start) // step).astype(int)


def _track_status_per_tick(session, grid: pd.DataFrame, start, end, step) -> pd.Series:
    """
    every status active during each tick, concatenated like the per-lap TrackStatus
    ("12" = clear then yellow), so .str.contains() works the same way
    """
    ts = session.track_status[["Time", "Status"]].sort_values("Time")

    # status already active when the tick starts
    at_start = pd.merge_asof(grid[["SessionTime"]], ts.rename(columns={"Time": "SessionTime"}),
                             on="SessionTime", direction="backward")["Status"]

    # plus any status that begins inside the tick
    changes = ts[(ts["Time"] > start) & (ts["Time"] < end)]
    during = changes.groupby(_bin_index(changes["Time"], start, step))["Status"].agg(set)

    codes = []
    for i, first in enumerate(at_start):
        active = during.get(i, set()) | ({first} if isinstance(first, str) else set())
        codes.append("".join(sorted(active)))
    return pd.Series(codes, index=grid.index)


def _cars_on_track(laps, ticks: pd.Series) -> np.ndarray:
    """number of drivers out on track (not in the pit lane or garage) at each tick"""
    on_from = laps[["LapStartTime", "PitOutTime"]].max(axis=1)
    on_to = laps[["Time", "PitInTime"]].min(axis=1)
    valid = on_from.notna() & on_to.notna()
    on_from, on_to = on_from[valid].to_numpy(), on_to[valid].to_numpy()
    drivers = laps.loc[valid, "Driver"].to_numpy()

    counts = []
    for t in ticks.to_numpy():
        on_track = (on_from <= t) & (t < on_to)
        counts.append(len(set(drivers[on_track])))
    return np.array(counts)


def session_timeline(session, freq: str = "1min") -> pd.DataFrame:
    """
    one row per `freq` tick from session start to finish:
    weather, track status, session status, cars on track, laps completed,
    and the race control messages issued during the tick

    session must be loaded with laps, weather and messages (same as summarize_session)
    """
    start, end = session_window(session)
    step = pd.Timedelta(freq)
    t0_date = _session_t0_date(session, start, end)

    grid = pd.DataFrame({"SessionTime": pd.timedelta_range(start, end, freq=step)})
    grid.insert(0, "minute", _seconds(grid["SessionTime"] - start) / 60)
    grid["Date"] = t0_date + grid["SessionTime"]

    # weather: latest reading at or before each tick (weather is sampled about once a minute)
    weather = session.weather_data.rename(columns={"Time": "SessionTime"}).sort_values("SessionTime")
    grid = pd.merge_asof(grid, weather, on="SessionTime", direction="backward")

    # session status (Started / Aborted / Finished) at each tick
    status = session.session_status.rename(columns={"Time": "SessionTime", "Status": "session_status"})
    grid = pd.merge_asof(grid, status.sort_values("SessionTime"), on="SessionTime", direction="backward")

    # track status during each tick, plus one boolean per interruption type
    grid["track_status"] = _track_status_per_tick(session, grid, start, end, step)
    grid["is_yellow"] = grid["track_status"].str.contains("2")
    grid["is_sc"] = grid["track_status"].str.contains("4")
    grid["is_red"] = grid["track_status"].str.contains("5")
    grid["is_vsc"] = grid["track_status"].str.contains("6|7")

    # running order: how many cars are out, and the most laps anyone has completed
    laps = session.laps[~session.laps["FastF1Generated"]]
    grid["cars_on_track"] = _cars_on_track(laps, grid["SessionTime"])
    finished = laps[["Time", "LapNumber"]].dropna().sort_values("Time")
    finished["LapNumber"] = finished["LapNumber"].cummax()
    grid = pd.merge_asof(grid, finished.rename(columns={"Time": "SessionTime", "LapNumber": "max_laps_completed"}),
                         on="SessionTime", direction="backward")
    grid["max_laps_completed"] = grid["max_laps_completed"].fillna(0).astype(int)

    # race control messages: Time is a UTC timestamp, convert to session time first
    rc = session.race_control_messages.copy()
    rc["SessionTime"] = rc["Time"] - t0_date
    rc = rc[(rc["SessionTime"] >= start) & (rc["SessionTime"] <= end)]
    by_tick = rc.groupby(_bin_index(rc["SessionTime"], start, step))["Message"]
    grid["rc_n"] = by_tick.size().reindex(grid.index, fill_value=0)
    grid["rc_messages"] = by_tick.agg(" | ".join).reindex(grid.index)
    return grid
