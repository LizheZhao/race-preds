# Databricks notebook source
# Load one ingested session directory into the bronze Delta tables
import sys

sys.path.insert(0, dbutils.widgets.get("repo_root"))

from src.etl.bronze import load_session

session_dir = dbutils.widgets.get("session_dir")

# COMMAND ----------

counts = load_session(spark, session_dir)
print(f"{session_dir}: {counts}")
