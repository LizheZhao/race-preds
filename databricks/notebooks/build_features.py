# Databricks notebook source
# MAGIC %pip install fastf1==3.8.3

# COMMAND ----------

# Rebuild race_preds.gold.features from gold and silver, then check sampled rows for leakage.
# live_season / live_round name a round in progress, whose schedule comes from FastF1; the
# dispatcher passes it with leakage_samples 0, the Tuesday run checks
import sys
import tempfile

sys.path.insert(0, dbutils.widgets.get("repo_root"))

from src.etl import features

samples = int(dbutils.widgets.get("leakage_samples"))
live = (dbutils.widgets.get("live_season"), dbutils.widgets.get("live_round"))

# COMMAND ----------

schedule = None
if all(live):
    import fastf1
    from src.config import enable_cache
    from src.sessions import get_sessions

    enable_cache(cache_dir=f"{tempfile.gettempdir()}/fastf1_cache")
    season, rnd = map(int, live)
    fmt = fastf1.get_event(season, rnd)["EventFormat"]
    schedule = [(season, rnd, s["session_id"], fmt, s["session_dt_utc"].to_pydatetime().replace(tzinfo=None))
                for s in get_sessions(season, rnd)]
    print(f"round in progress: {season} R{rnd} {[s[2] for s in schedule]}")

rows = features.load(spark, schedule)
print(f"{features.TABLE}: {rows} rows")
display(spark.sql(f"""SELECT season, COUNT(DISTINCT round) AS rounds, COUNT(*) AS rows
                      FROM {features.TABLE} GROUP BY season ORDER BY season"""))

# COMMAND ----------

# The table is only usable if a row never reads data from after its stage
if samples:
    problems = features.leakage_check(spark, samples=samples)
    for p in problems:
        print(f"x {p}")
    if problems:
        raise AssertionError(f"leakage check: {len(problems)} of {samples} samples differ")
    print(f"leakage check: {samples} samples OK")
