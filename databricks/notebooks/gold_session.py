# Databricks notebook source
# MAGIC %pip install fastf1==3.8.3

# COMMAND ----------

# Rebuild one session in the gold Delta tables; src.summaries imports FastF1 via src.sessions
import sys

sys.path.insert(0, dbutils.widgets.get("repo_root"))

from src.etl.gold import load_session
from src.etl.ops import track

season = int(dbutils.widgets.get("season"))
rnd = int(dbutils.widgets.get("round"))
session_id = dbutils.widgets.get("session_id")

# COMMAND ----------

with track(spark, season, rnd, session_id, "gold"):
    counts = load_session(spark, season, rnd, session_id)
print(f"{season} R{rnd} {session_id}: {counts}")
