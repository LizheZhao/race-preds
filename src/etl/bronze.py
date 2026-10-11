"""
bronze layer: one ingested session's Parquet loaded into Delta, one table per entity

    race_preds.bronze.{laps,results,weather,track_status,session_status,race_control}
    race_preds.bronze.sessions   one row per session from meta.json (name, format, start)

every row gets the session key (season, round, session_id) and the ingest metadata
(pulled_at, fastf1_version) from meta.json. A session is replaced as a whole with
replaceWhere, so re-running a session gives the same rows and leaves other sessions alone.
Spark only, no FastF1: the bronze task does not install it
"""
import json
from pathlib import Path

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

SCHEMA = "race_preds.bronze"
KEY = ["season", "round", "session_id"]


def load_session(spark: SparkSession, session_dir: str) -> dict[str, int]:
    """write every <table>.parquet in session_dir to its bronze table; returns rows per table"""
    src = Path(session_dir)
    meta = json.loads((src / "meta.json").read_text())
    key = {"season": int(meta["season"]), "round": int(meta["round"]), "session_id": meta["session_id"]}
    where = f"season = {key['season']} AND round = {key['round']} AND session_id = '{key['session_id']}'"

    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    counts = {}
    for path in sorted(src.glob("*.parquet")):
        table = f"{SCHEMA}.{path.stem}"
        raw = spark.read.parquet(str(path))
        df = raw.select(
            F.lit(key["season"]).alias("season"),
            F.lit(key["round"]).alias("round"),
            F.lit(key["session_id"]).alias("session_id"),
            *raw.columns,
            F.lit(meta["pulled_at"]).cast("timestamp").alias("pulled_at"),
            F.lit(meta["fastf1_version"]).alias("fastf1_version"),
        )
        (df.write.format("delta").mode("overwrite")
           .option("replaceWhere", where)
           .option("mergeSchema", "true")
           .saveAsTable(table))
        counts[path.stem] = spark.table(table).where(where).count()

    # the session itself: what summarize_session needs besides the six tables
    sessions = spark.createDataFrame(
        [(key["season"], key["round"], key["session_id"], meta["session"], meta["event_format"],
          meta["date"], meta["pulled_at"], meta["fastf1_version"])],
        "season INT, round INT, session_id STRING, session STRING, event_format STRING, "
        "date STRING, pulled_at STRING, fastf1_version STRING",
    ).withColumns({"date": F.col("date").cast("timestamp_ntz"),  # scheduled start, UTC
                   "pulled_at": F.col("pulled_at").cast("timestamp")})
    (sessions.write.format("delta").mode("overwrite")
       .option("replaceWhere", where)
       .saveAsTable(f"{SCHEMA}.sessions"))
    counts["sessions"] = spark.table(f"{SCHEMA}.sessions").where(where).count()
    return counts
