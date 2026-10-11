# Databricks notebook source
# Rebuild one session in the silver Delta tables from bronze
import sys

sys.path.insert(0, dbutils.widgets.get("repo_root"))

from src.etl.silver import load_session

season = int(dbutils.widgets.get("season"))
rnd = int(dbutils.widgets.get("round"))
session_id = dbutils.widgets.get("session_id")

# COMMAND ----------

counts = load_session(spark, season, rnd, session_id)
print(f"{season} R{rnd} {session_id}: {counts}")
