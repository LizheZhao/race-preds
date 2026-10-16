"""
check the lakehouse against the FastF1 schedule, one row per season × round × session
(docs/pipeline-plan.md, Phase 3 plan step 1, Check)

    python -m src.dispatch.verify 2022-2026            # every session that has happened
    python -m src.dispatch.verify 2023 --csv out.csv   # one season, the full table saved

per session: the state of each stage in ops.processed_sessions, row and driver counts in
bronze, silver and gold, and the drivers silver could not give an Ergast id. A session is
complete when every stage succeeded, gold has its session row and the driver counts agree
from bronze results to gold. Prints a per-season summary, then every gap; exits 1 if there
is one. Reads through the SQL warehouse: one query per table
"""
import argparse
from datetime import datetime, timedelta, timezone

import fastf1
import pandas as pd

from src.config import enable_cache
from src.publish import lakehouse as lh
from src.sessions import SESSION_IDS

KEY = ["season", "round", "session_id"]
STAGES = ["ingest", "bronze", "silver", "gold"]
SETTLED = timedelta(hours=6)  # a session younger than this may still be on its way in

# (column prefix, table, driver column or None); each gives <prefix>_rows and <prefix>_drivers
COUNTS = [
    ("bronze_laps", "race_preds.bronze.laps", "Driver"),
    ("bronze_results", "race_preds.bronze.results", "Abbreviation"),
    ("silver_laps", "race_preds.silver.laps", "driver"),
    ("silver_results", "race_preds.silver.results", "driver"),
    ("gold_drivers", "race_preds.gold.driver_session", "driver"),
    ("gold_session", "race_preds.gold.session", None),
    ("gold_stints", "race_preds.gold.stints", None),
]


def parse_seasons(spec: str) -> list[int]:
    lo, _, hi = spec.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def scheduled(seasons: list[int], now: datetime) -> pd.DataFrame:
    """every session of the given seasons that started at least SETTLED ago"""
    rows = []
    for season in seasons:
        schedule = fastf1.get_event_schedule(season, include_testing=False)
        for _, event in schedule.iterrows():
            for i in range(1, 6):
                name, start = event[f"Session{i}"], event[f"Session{i}DateUtc"]
                if name in SESSION_IDS and pd.notna(start) and start.tz_localize("UTC") + SETTLED < now:
                    rows.append({"season": season, "round": int(event["RoundNumber"]),
                                 "session_id": SESSION_IDS[name], "event": event["EventName"]})
    return pd.DataFrame(rows, columns=[*KEY, "event"])


def _seasons_in(seasons: list[int]) -> str:
    return "(" + ", ".join(str(int(s)) for s in seasons) + ")"


def counts(seasons: list[int]) -> pd.DataFrame:
    """row and driver counts per session in every table of COUNTS, outer-joined on the key"""
    out = None
    for prefix, table, driver in COUNTS:
        drivers = f", COUNT(DISTINCT {driver}) AS {prefix}_drivers" if driver else ""
        df = lh.query(f"""SELECT season, round, session_id, COUNT(*) AS {prefix}_rows{drivers}
                          FROM {table} WHERE season IN {_seasons_in(seasons)}
                          GROUP BY season, round, session_id""")
        out = df if out is None else out.merge(df, on=KEY, how="outer")
    missing_ids = lh.query(f"""SELECT season, round, session_id, COUNT(*) AS no_ergast_id
                               FROM race_preds.silver.results
                               WHERE season IN {_seasons_in(seasons)} AND driver_id IS NULL
                               GROUP BY season, round, session_id""")
    return out.merge(missing_ids, on=KEY, how="outer")


def states(seasons: list[int]) -> pd.DataFrame:
    """ops.processed_sessions pivoted to one column per stage, plus the first error"""
    df = lh.query(f"""SELECT season, round, session_id, stage, status, error
                      FROM race_preds.ops.processed_sessions WHERE season IN {_seasons_in(seasons)}""")
    wide = df.pivot_table(index=KEY, columns="stage", values="status", aggfunc="first")
    wide = wide.reindex(columns=STAGES).reset_index()
    errors = (df[df["status"] != "succeeded"].sort_values("stage")
              .groupby(KEY)["error"].first().str.slice(0, 120).rename("error").reset_index())
    return wide.merge(errors, on=KEY, how="left")


def problems(row: pd.Series) -> list[str]:
    """why one session is not complete; empty when it is"""
    if pd.isna(row["event"]):
        return ["in the lakehouse but not on the schedule"]
    found = []
    stages = {s: row[s] for s in STAGES if pd.notna(row[s])}
    if not stages:
        found.append("never run")
    elif row["ingest"] == "not_available":
        found.append("not_available")
    elif any(v != "succeeded" for v in stages.values()) or len(stages) < len(STAGES):
        found.append("stages " + ", ".join(f"{s}={stages.get(s, '-')}" for s in STAGES))
    if stages and not row["gold_session_rows"] > 0:
        found.append("no gold.session row")
    drivers = [row[c] for c in ("bronze_results_drivers", "silver_results_drivers", "gold_drivers_drivers")]
    if stages and drivers[0] > 0 and len(set(drivers)) > 1:
        found.append("drivers bronze/silver/gold " + "/".join(str(int(d)) for d in drivers))
    if row["no_ergast_id"] > 0:
        found.append(f"{int(row['no_ergast_id'])} without an Ergast id")
    return found


def verify(seasons: list[int], now: datetime) -> pd.DataFrame:
    table = (scheduled(seasons, now)
             .merge(states(seasons), on=KEY, how="outer")
             .merge(counts(seasons), on=KEY, how="outer"))
    num = [c for c in table.columns if c.endswith(("_rows", "_drivers")) or c == "no_ergast_id"]
    table[num] = table[num].fillna(0).astype(int)
    table["problems"] = table.apply(lambda r: "; ".join(problems(r)), axis=1)
    return table.sort_values(KEY).reset_index(drop=True)


def summary(table: pd.DataFrame) -> pd.DataFrame:
    """per season: sessions and rounds scheduled and complete, and what kind of gap the rest have"""
    t = table.assign(
        scheduled=table["event"].notna(),
        complete=table["problems"] == "",
        not_available=table["ingest"] == "not_available",
        never_run=table["problems"].str.contains("never run"),
    )
    t["other_gap"] = ~t["complete"] & ~t["not_available"] & ~t["never_run"]
    s = t.groupby("season")[["scheduled", "complete", "not_available", "never_run", "other_gap"]].sum()
    by_round = t[t["scheduled"]].groupby(["season", "round"])["complete"].all()
    s["rounds"] = by_round.groupby("season").size()
    s["rounds_complete"] = by_round.groupby("season").sum()
    s["gold_driver_rows"] = table.groupby("season")["gold_drivers_rows"].sum()
    s["silver_lap_rows"] = table.groupby("season")["silver_laps_rows"].sum()
    return s.fillna(0).astype(int)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("seasons", type=parse_seasons, help="e.g. 2022-2026 or 2023")
    parser.add_argument("--csv", help="also save the full per-session table here")
    args = parser.parse_args()

    enable_cache()
    result = verify(args.seasons, datetime.now(timezone.utc))
    if args.csv:
        result.to_csv(args.csv, index=False)
    with pd.option_context("display.width", 220, "display.max_columns", 20, "display.max_rows", 600,
                           "display.max_colwidth", 80):
        print(summary(result).to_string(), "\n")
        gaps = result[result["problems"] != ""]
        cols = [*KEY, *STAGES, "bronze_results_drivers", "gold_drivers_drivers", "problems", "error"]
        print(f"{len(gaps)} sessions with a gap" + (":" if len(gaps) else ""))
        if len(gaps):
            print(gaps[cols].to_string(index=False))
    if (result["problems"] != "").any():
        raise SystemExit(1)
