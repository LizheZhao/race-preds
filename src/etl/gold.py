"""
gold layer: analysis-grain tables the models read, built by the exploration functions unchanged

    race_preds.gold.driver_session  one row per driver x session    summarize_session -> by_driver
    race_preds.gold.session         one row per session; the        summarize_session -> session_row
                                    race_incidents labels
    race_preds.gold.stints          one row per clean long run      long_runs

the functions are written against FastF1's column names, so they read bronze; silver is
the conformed layer for Spark-native work. Two ways of running pandas code:

- long_runs needs only laps, so it runs as a pandas UDF, groupBy(session).applyInPandas,
  which also covers a backfill of many sessions in one call
- summarize_session needs all six tables of a session at once; applyInPandas hands one
  table per group (cogroup two), so gold collects one session's tables to the driver,
  a few hundred KB, and calls it there

Ergast ids come from silver.results, which fills them from any session of the round.
A session is replaced as a whole with replaceWhere, like bronze and silver
"""
import pandas as pd
from pyspark.sql import DataFrame, SparkSession

from src.ingest.fastf1_session import TABLES
from src.long_runs import stint_runs
from src.sessions import SessionTables
from src.summaries import summarize_session

BRONZE = "race_preds.bronze"
SILVER = "race_preds.silver"
GOLD = "race_preds.gold"
KEY = ["season", "round", "session_id"]
BRONZE_ONLY = [*KEY, "pulled_at", "fastf1_version"]

STINTS_SCHEMA = ("season INT, round INT, session_id STRING, driver STRING, stint INT, "
                 "compound STRING, laps INT, median_lap_s DOUBLE, deg_s_per_lap DOUBLE")


def _where(season: int, rnd: int, session_id: str) -> str:
    return f"season = {season} AND round = {rnd} AND session_id = '{session_id}'"


def _session_tables(spark: SparkSession, where: str) -> SessionTables:
    """one session's bronze tables as the SessionTables the exploration functions take"""
    meta = spark.table(f"{BRONZE}.sessions").where(where).toPandas().iloc[0]
    return SessionTables(
        season=int(meta["season"]), round=int(meta["round"]), session=meta["session"],
        event_format=meta["event_format"], date=pd.Timestamp(meta["date"]),
        **{t: spark.table(f"{BRONZE}.{t}").where(where).drop(*BRONZE_ONLY).toPandas() for t in TABLES},
    )


def _to_spark(spark: SparkSession, pdf: pd.DataFrame) -> DataFrame:
    """pandas -> Spark with stable types: text columns as string even when all empty"""
    text = pdf.select_dtypes("object").columns
    return spark.createDataFrame(pdf.astype({c: "string" for c in text}))


def _stints(laps: pd.DataFrame) -> pd.DataFrame:
    """applyInPandas body: one session's bronze laps -> its long runs"""
    keys = laps[KEY].iloc[0]
    runs = stint_runs(laps).rename(columns={"Driver": "driver", "Stint": "stint", "Compound": "compound"})
    return runs.assign(**keys)[["season", "round", "session_id", "driver", "stint", "compound",
                                "laps", "median_lap_s", "deg_s_per_lap"]]


def build_session(spark: SparkSession, season: int, rnd: int, session_id: str) -> dict[str, DataFrame]:
    """the gold rows of one session, not yet written"""
    where = _where(season, rnd, session_id)
    key = {"season": season, "round": rnd, "session_id": session_id}
    ids = (spark.table(f"{SILVER}.results").where(where)
           .select("driver", "driver_id", "constructor_id").toPandas())

    by_driver, session_row = summarize_session(_session_tables(spark, where))
    by_driver = (by_driver
                 .drop(columns=["season", "round", "DriverId"])
                 .rename(columns={"session": "session_name", "Driver": "driver", "DriverNumber": "driver_number"})
                 .merge(ids, on="driver", how="left"))
    by_driver = by_driver.assign(**key)[[*KEY, "driver", "driver_id", "constructor_id",
                                         *[c for c in by_driver.columns if c not in (*KEY, "driver", "driver_id", "constructor_id")]]]
    session_row = (session_row.drop(columns=["season", "round"])
                   .rename(columns={"session": "session_name"}))
    session_row = session_row.assign(**key)[[*KEY, *[c for c in session_row.columns if c not in KEY]]]

    stints = (spark.table(f"{BRONZE}.laps").where(where)
              .groupBy(*KEY).applyInPandas(_stints, STINTS_SCHEMA))
    return {
        "driver_session": _to_spark(spark, by_driver),
        "session": _to_spark(spark, session_row),
        "stints": stints,
    }


def load_session(spark: SparkSession, season: int, rnd: int, session_id: str) -> dict[str, int]:
    """rebuild one session in the gold tables; returns rows per table"""
    where = _where(season, rnd, session_id)
    built = build_session(spark, season, rnd, session_id)

    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {GOLD}")
    counts = {}
    for name, df in built.items():
        table = f"{GOLD}.{name}"
        (df.write.format("delta").mode("overwrite")
           .option("replaceWhere", where)
           .option("mergeSchema", "true")
           .saveAsTable(table))
        counts[name] = spark.table(table).where(where).count()
    return counts
