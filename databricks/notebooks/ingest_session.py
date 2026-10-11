# Databricks notebook source
# MAGIC %pip install fastf1==3.8.3

# COMMAND ----------

# Job parameters arrive as widgets; repo_root is where the bundle deployed src/
import sys
import tempfile

season = int(dbutils.widgets.get("season"))
rnd = int(dbutils.widgets.get("round"))
session_id = dbutils.widgets.get("session_id")
sys.path.insert(0, dbutils.widgets.get("repo_root"))

from src.config import enable_cache
from src.ingest.fastf1_session import ingest_session

RAW_ROOT = "/Volumes/race_preds/raw/fastf1"
# FastF1's HTTP cache is SQLite, which cannot run on a Volume (no random writes / locks);
# use the job's local disk, which is wiped after the run
CACHE_DIR = f"{tempfile.gettempdir()}/fastf1_cache"

# COMMAND ----------

# Pull one session into the raw Volume (overwrites a previous pull)
enable_cache(cache_dir=CACHE_DIR)
out = ingest_session(season, rnd, session_id, RAW_ROOT)
print(f"{out}: {sorted(p.name for p in out.iterdir())}")
