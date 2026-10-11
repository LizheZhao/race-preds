"""
the dispatcher: given a round and a clock, bring the lakehouse up to date and publish

    stage_at(now)      the stage the clock has reached (None before the Thursday build)
    dispatch(now)      process every session of that stage not yet in gold, then publish it

the scheduled GitHub Actions run calls it with the real clock; a replay calls it with a
fake one, stage by stage. Picking the round from the clock is left to that workflow
"""
from datetime import datetime
from pathlib import Path

import pandas as pd

from src import schema
from src.dispatch import jobs
from src.publish.documents import Context, utc
from src.publish.site import publish
from src.sessions import get_session_stage, get_sessions

PRE_WEEKEND_LEAD = pd.Timedelta(hours=20)  # Thursday build, the day before first practice
# FastF1 data is usually there 30-60 min after a session ends; sessions run 1 h, races 2 h
READY_AFTER = {"R": pd.Timedelta(hours=3)}
READY_AFTER_DEFAULT = pd.Timedelta(hours=2)


def ready_at(session: dict) -> pd.Timestamp:
    return pd.Timestamp(utc(session["session_dt_utc"])) + READY_AFTER.get(session["session_id"], READY_AFTER_DEFAULT)


def pre_weekend_at(season: int, rnd: int) -> pd.Timestamp:
    return pd.Timestamp(utc(get_sessions(season, rnd)[0]["session_dt_utc"])) - PRE_WEEKEND_LEAD


def stage_at(season: int, rnd: int, now: datetime) -> str | None:
    now = pd.Timestamp(now)
    if now < pre_weekend_at(season, rnd):
        return None
    stage = "pre_weekend"
    for s in get_sessions(season, rnd):
        if ready_at(s) > now:
            break
        stage = s["session_id"]
    return stage


def dispatch(season: int, rnd: int, now: datetime, site: Path, run_id: str) -> str | None:
    """returns the stage published, or None when the clock is before the weekend"""
    stage = stage_at(season, rnd, now)
    if stage is None:
        return None

    done = jobs.processed_sessions(season, rnd)
    order = ["pre_weekend", *[s["session_id"] for s in get_sessions(season, rnd)]]
    for sid in get_session_stage(season, rnd, stage):
        if sid in done:
            continue
        print(f"  processing {season} R{rnd} {sid} on Databricks")
        if jobs.run_session(season, rnd, sid) == "not_available":
            stage = order[order.index(sid) - 1]  # publish what is there; the next run retries
            print(f"  {sid} has no data yet, publishing stage {stage}")
            break

    sections = publish(Context.at(season, rnd, stage, now, run_id), site)
    print(f"  published {season} R{rnd} at {stage}: "
          + ", ".join(f"{k} {v.status}" for k, v in sections.items()))
    return stage
