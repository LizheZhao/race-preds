from dataclasses import dataclass

import pandas as pd
import fastf1

SESSION_IDS = {
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
    "Qualifying": "Q",
    "Sprint Qualifying": "SQ",
    "Sprint Shootout": "SQ",
    "Sprint": "S",
    "Race": "R",
}

SESSION_ORDER = {
    "conventional": ["FP1", "FP2", "FP3", "Q", "R"],
    "sprint": ["FP1", "Q", "FP2", "S", "R"],
    "sprint_shootout": ["FP1", "Q", "SQ", "S", "R"],
    "sprint_qualifying": ["FP1", "SQ", "S", "Q", "R"],
}


def load_weekend(year, rnd):
    """every session of one weekend, keyed by session id, loaded without telemetry"""
    event = fastf1.get_event(year, rnd)
    sessions = {}
    for i in range(1, 6):
        name = event[f"Session{i}"]
        if name in SESSION_IDS:
            s = event.get_session(name)
            s.load(telemetry=False)
            sessions[SESSION_IDS[name]] = s
    return sessions


def get_sessions(year: int, rnd: int) -> list[dict]:
    """the weekend's sessions as dicts: session_id, session_name, session_dt, session_dt_utc"""
    event = fastf1.get_event(year, rnd)
    sessions = []
    for i in range(1, 6):
        name = event[f"Session{i}"]
        dt = event[f"Session{i}Date"]
        utc_dt = event[f"Session{i}DateUtc"]
        if name in SESSION_IDS:
            sessions.append({"session_id": SESSION_IDS[name], "session_name": name,
                             "session_dt": dt, "session_dt_utc": utc_dt})
    return sessions


def get_session_stage(year: int, rnd: int, stage: str):
    """sessions usable at a stage, in weekend order; pre_weekend has none"""
    if stage == "pre_weekend":
        return []
    if stage not in SESSION_IDS.values():
        raise ValueError(f"stage must be pre_weekend or one of {sorted(set(SESSION_IDS.values()))}")
    sessions = get_sessions(year, rnd)
    prev_stages = []
    for s in sessions:
        if s["session_id"] != stage:
            prev_stages.append(s["session_id"])
        else:
            break
    if len(prev_stages) == len(sessions):
        raise ValueError(f"stage {stage} not occurred in {year} race round {rnd}, valid stages: {prev_stages}")
    prev_stages.append(stage)
    return prev_stages


def _to_seconds(df) -> pd.DataFrame:
    """plain DataFrame copy with every Timedelta column as float seconds"""
    df = pd.DataFrame(df)
    timedeltas = df.select_dtypes("timedelta").columns
    return df.assign(**{c: df[c].dt.total_seconds() for c in timedeltas})


@dataclass(frozen=True)
class SessionTables:
    """
    one session as plain DataFrames: what ingest writes to the Volume and what the
    exploration functions read, so the same code runs on a FastF1 Session locally and
    on tables in Spark (applyInPandas)

    every Timedelta column is float seconds; timestamps (laps LapStartDate, race_control
    Time, date) stay UTC datetimes
    """
    season: int
    round: int
    session: str  # FastF1 session name, e.g. "Race"
    event_format: str
    date: pd.Timestamp  # scheduled start, UTC
    laps: pd.DataFrame
    results: pd.DataFrame
    weather: pd.DataFrame
    track_status: pd.DataFrame
    session_status: pd.DataFrame
    race_control: pd.DataFrame

    @classmethod
    def from_session(cls, session) -> "SessionTables":
        """session must be loaded with laps, weather and messages"""
        return cls(
            season=int(session.event.year),
            round=int(session.event["RoundNumber"]),
            session=session.name,
            event_format=session.event["EventFormat"],
            date=session.date,
            laps=_to_seconds(session.laps),
            results=_to_seconds(session.results),
            weather=_to_seconds(session.weather_data),
            track_status=_to_seconds(session.track_status),
            session_status=_to_seconds(session.session_status),
            race_control=_to_seconds(session.race_control_messages),
        )


def as_tables(session) -> SessionTables:
    """accept a loaded FastF1 Session or SessionTables, so notebooks can keep passing sessions"""
    return session if isinstance(session, SessionTables) else SessionTables.from_session(session)


def session_window(tables: SessionTables) -> tuple[float, float]:
    """first "Started" to last "Finished", in session seconds"""
    status = tables.session_status
    start = status.loc[status["Status"] == "Started", "Time"].min()
    end = status.loc[status["Status"] == "Finished", "Time"].max()
    if pd.isna(start):
        start = 0.0
    if pd.isna(end):
        end = tables.laps["Time"].max()
    return start, end
