# Databricks notebook source
# MAGIC %pip install fastf1==3.8.3

# COMMAND ----------

# Backfill one round: every session in its schedule through ingest -> bronze -> silver -> gold,
# recorded in ops.processed_sessions exactly like process_session. One task per round, so the
# round pays one cold start and its sessions share one FastF1 cache
import sys
import tempfile
import time

season = int(dbutils.widgets.get("season"))
rnd = int(dbutils.widgets.get("round"))
redo = dbutils.widgets.get("redo").lower() == "true"
sys.path.insert(0, dbutils.widgets.get("repo_root"))

from src.config import enable_cache
from src.etl import bronze, gold, silver
from src.etl.ops import TABLE, track
from src.ingest.fastf1_session import SessionNotAvailable, ingest_session
from src.sessions import get_sessions

RAW_ROOT = "/Volumes/race_preds/raw/fastf1"
# SQLite cache: local disk, not the Volume (see ingest_session.py)
enable_cache(cache_dir=f"{tempfile.gettempdir()}/fastf1_cache")

# COMMAND ----------

# Sessions already in gold, or that never had data, are skipped unless redo is set; a past
# session without data stays without it, unlike a live one that is still on its way
def finished(season: int, rnd: int) -> set[str]:
    if not spark.catalog.tableExists(TABLE):
        return set()
    rows = spark.sql(f"""SELECT session_id FROM {TABLE}
                         WHERE season = :season AND round = :round
                           AND ((stage = 'gold' AND status = 'succeeded')
                             OR (stage = 'ingest' AND status = 'not_available'))""",
                     args={"season": season, "round": rnd}).collect()
    return {r.session_id for r in rows}

sessions = [s["session_id"] for s in get_sessions(season, rnd)]
skip = set() if redo else finished(season, rnd)
print(f"{season} R{rnd}: {sessions}, skipping {sorted(skip & set(sessions)) or 'none'}")

# COMMAND ----------

# One session after another; a failure is recorded and the loop goes on, the task fails at the end
outcome, failed = {}, []
for sid in sessions:
    if sid in skip:
        outcome[sid] = "skipped"
        continue
    started = time.monotonic()
    try:
        with track(spark, season, rnd, sid, "ingest", not_available=(SessionNotAvailable,)):
            out = ingest_session(season, rnd, sid, RAW_ROOT)
        with track(spark, season, rnd, sid, "bronze"):
            bronze.load_session(spark, str(out))
        with track(spark, season, rnd, sid, "silver"):
            silver.load_session(spark, season, rnd, sid)
        with track(spark, season, rnd, sid, "gold"):
            counts = gold.load_session(spark, season, rnd, sid)
        outcome[sid] = f"gold {counts}"
    except SessionNotAvailable as exc:
        outcome[sid] = f"not_available: {exc}"
    except Exception as exc:
        outcome[sid] = f"failed: {type(exc).__name__}: {exc}"
        failed.append(sid)
    print(f"  {sid:<3} {time.monotonic() - started:6.1f} s  {outcome[sid]}")

if failed:
    raise RuntimeError(f"{season} R{rnd}: {failed} failed, see ops.processed_sessions")
