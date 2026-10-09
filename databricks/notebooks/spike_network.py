# Databricks notebook source
# MAGIC %pip install fastf1

# COMMAND ----------

import requests, fastf1
for url in ["https://api.jolpi.ca/ergast/f1/2025.json",
            "https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&hourly=temperature_2m",
            "https://livetiming.formula1.com/static/2025/2025-03-16_Australian_Grand_Prix/2025-03-16_Race/SessionInfo.json"]:
    print(url, requests.get(url, timeout=10).status_code)

# COMMAND ----------

s = fastf1.get_session(2025, 1, "R")
s.load(telemetry=False)
print(len(s.laps), "laps")