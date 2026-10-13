"""
the dispatcher: given a round and a clock, bring the lakehouse up to date and publish

    stage_at(now)      the stage the clock has reached (None before the Thursday build)
    dispatch(now)      process every session of that stage not yet in gold, then publish it
    process(now)       the same without publishing, for a caller that publishes only on change

the scheduled run (run.py) calls process() with the real clock and picks the round; a
replay calls dispatch() with a fake clock, stage by stage
"""
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pandas as pd

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


@dataclass(frozen=True)
class Progress:
    """what one dispatcher run brought the lakehouse up to, before anything is published"""
    stage: str  # the last stage whose sessions are all in gold
    processed: tuple[str, ...] = ()  # sessions this run took to gold
    error: Exception | None = None  # a session job that failed; publish `stage`, then raise it


def process(season: int, rnd: int, now: datetime) -> Progress | None:
    """run every session of the stage the clock has reached that is not in gold yet; None before the weekend"""
    stage = stage_at(season, rnd, now)
    if stage is None:
        return None

    done = jobs.processed_sessions(season, rnd)
    order = ["pre_weekend", *[s["session_id"] for s in get_sessions(season, rnd)]]
    processed = []
    for sid in get_session_stage(season, rnd, stage):
        if sid in done:
            continue
        print(f"  processing {season} R{rnd} {sid} on Databricks")
        try:
            outcome = jobs.run_session(season, rnd, sid)
        except Exception as e:
            print(f"  {sid} failed, publishing stage {order[order.index(sid) - 1]}: {e}")
            return Progress(order[order.index(sid) - 1], tuple(processed), e)
        if outcome == "not_available":
            stage = order[order.index(sid) - 1]  # publish what is there; the next run retries
            print(f"  {sid} has no data yet, publishing stage {stage}")
            break
        processed.append(sid)
    return Progress(stage, tuple(processed))


def publish_stage(season: int, rnd: int, stage: str, now: datetime, site: Path, run_id: str) -> None:
    sections = publish(Context.at(season, rnd, stage, now, run_id), site)
    print(f"  published {season} R{rnd} at {stage}: "
          + ", ".join(f"{k} {v.status}" for k, v in sections.items()))


def dispatch(season: int, rnd: int, now: datetime, site: Path, run_id: str) -> str | None:
    """process and always publish; returns the stage published, or None when the clock is before the weekend"""
    progress = process(season, rnd, now)
    if progress is None:
        return None
    publish_stage(season, rnd, progress.stage, now, site, run_id)
    if progress.error:
        raise progress.error
    return progress.stage
