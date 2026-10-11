# Databricks notebook source
# Load one ingested session directory into the bronze Delta tables
import sys

sys.path.insert(0, dbutils.widgets.get("repo_root"))

from src.etl.bronze import load_session
from src.etl.ops import track

season = int(dbutils.widgets.get("season"))
rnd = int(dbutils.widgets.get("round"))
session_id = dbutils.widgets.get("session_id")
session_dir = dbutils.widgets.get("session_dir")

# COMMAND ----------

with track(spark, season, rnd, session_id, "bronze"):
    counts = load_session(spark, session_dir)
print(f"{session_dir}: {counts}")
