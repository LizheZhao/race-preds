"""
race_preds.ops.processed_sessions: one row per (season, round, session_id, stage) with the
latest status of that pipeline stage, when it changed, and the error if it failed

    stage   ingest | bronze | silver | gold   (later: score, publish)
    status  succeeded | failed | not_available

the dispatcher reads it to decide what still needs doing. Spark only
"""
from contextlib import contextmanager

from pyspark.sql import SparkSession

TABLE = "race_preds.ops.processed_sessions"


def record(spark: SparkSession, season: int, rnd: int, session_id: str, stage: str,
           status: str, error: str | None = None) -> None:
    """upsert the status of one stage of one session"""
    spark.sql("CREATE SCHEMA IF NOT EXISTS race_preds.ops")
    spark.sql(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        season INT, round INT, session_id STRING, stage STRING,
        status STRING, updated_at TIMESTAMP, error STRING)""")
    spark.sql(f"""
        MERGE INTO {TABLE} t
        USING (SELECT :season AS season, :round AS round, :session_id AS session_id,
                      :stage AS stage, :status AS status, current_timestamp() AS updated_at,
                      CAST(:error AS STRING) AS error) s
        ON t.season = s.season AND t.round = s.round AND t.session_id = s.session_id AND t.stage = s.stage
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *""",
        args={"season": season, "round": rnd, "session_id": session_id, "stage": stage,
              "status": status, "error": error})


@contextmanager
def track(spark: SparkSession, season: int, rnd: int, session_id: str, stage: str,
          not_available: tuple[type[Exception], ...] = ()):
    """record succeeded, failed or not_available for the wrapped stage; errors are re-raised"""
    try:
        yield
    except not_available as exc:
        record(spark, season, rnd, session_id, stage, "not_available", str(exc))
        raise
    except Exception as exc:
        record(spark, season, rnd, session_id, stage, "failed", f"{type(exc).__name__}: {exc}"[:2000])
        raise
    record(spark, season, rnd, session_id, stage, "succeeded")
