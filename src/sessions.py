import pandas as pd
import fastf1

# session mapping
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

# session helper
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
    """every session of one weekend, keyed by session id, loaded without telemetry"""
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
    if stage not in SESSION_IDS.values():
        raise ValueError(f"stage must in {SESSION_IDS.values()}")
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
