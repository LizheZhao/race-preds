import pandas as pd
import numpy as np

from src.sessions import session_window


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
    grid.insert(0, "minute", (grid["SessionTime"] - start).dt.total_seconds() / 60)
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
