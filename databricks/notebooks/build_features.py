# Databricks notebook source
# Rebuild race_preds.gold.features from gold and silver, then check sampled rows for leakage
import sys

sys.path.insert(0, dbutils.widgets.get("repo_root"))

from src.etl import features

samples = int(dbutils.widgets.get("leakage_samples"))

# COMMAND ----------

rows = features.load(spark)
print(f"{features.TABLE}: {rows} rows")
display(spark.sql(f"""SELECT season, COUNT(DISTINCT round) AS rounds, COUNT(*) AS rows
                      FROM {features.TABLE} GROUP BY season ORDER BY season"""))

# COMMAND ----------

# The table is only usable if a row never reads data from after its stage
problems = features.leakage_check(spark, samples=samples)
for p in problems:
    print(f"x {p}")
if problems:
    raise AssertionError(f"leakage check: {len(problems)} of {samples} samples differ")
print(f"leakage check: {samples} samples OK")
