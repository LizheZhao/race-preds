import pandas as pd
import numpy as np

from src.sessions import session_window

# Race control message patterns. Driver abbreviations always appear as "(ABC)"
ABBR_RE = r"\(([A-Z]{3})\)"
TRACK_LIMITS_RE = r"^CAR \d+ \([A-Z]{3}\) (?:TIME \S+ |LAP )DELETED - TRACK LIMITS"
PENALTY_RE = r"PENALTY FOR CAR"
RAIN_RISK_RE = r"RISK OF RAIN.*?(\d+)\s*%"


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
    ts["minutes"] = (ts["End"] - ts["Time"]).dt.total_seconds() / 60
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
        feats[col] = feats[col].dt.total_seconds()
    feats["ideal_lap"] = feats[["best_s1", "best_s2", "best_s3"]].sum(axis=1, min_count=3)

    # mileage counts deleted laps too, they were still driven
    feats["laps_driven"] = driven.groupby("Driver").size()
    compound_laps = driven.groupby(["Driver", "Compound"]).size().unstack(fill_value=0)
    compound_laps.columns = [f"laps_{c.lower()}" for c in compound_laps.columns]
    feats = feats.join(compound_laps)

    # best lap on softs: the closest thing to quali sim
    feats["best_lap_soft"] = timed[timed["Compound"] == "SOFT"].groupby("Driver")["LapTime"].min().dt.total_seconds()

    # when the best lap happened, minutes into the session (late = low fuel / evolved track)
    best_rows = timed.dropna(subset=["LapTime"]).sort_values("LapTime").drop_duplicates("Driver")
    feats["best_lap_at_min"] = (best_rows.set_index("Driver")["LapStartTime"] - start).dt.total_seconds() / 60

    # clean green-flag laps for pace and consistency
    clean = timed.pick_wo_box().pick_track_status("1").pick_accurate().pick_quicklaps()
    clean_s = clean["LapTime"].dt.total_seconds().groupby(clean["Driver"])
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
        "duration_min": (end - start).total_seconds() / 60,
        "drivers_n": laps["Driver"].nunique(),
        "wet_laps_frac": laps["Compound"].isin(["INTERMEDIATE", "WET"]).mean(),
        **_weather_summary(session, start, end),
        **_track_status_summary(session, start, end),
        **_race_control_summary(session),
    }
    return by_driver, pd.DataFrame([session_row])
