"""
check the lakehouse against the FastF1 schedule, one row per season × round × session
(docs/pipeline-plan.md, Phase 3 plan step 1, Check)

    python -m src.dispatch.verify 2022-2026            # every session that has happened
    python -m src.dispatch.verify 2023 --csv out.csv   # one season, the full table saved

per session: the state of each stage in ops.processed_sessions, row and driver counts in
bronze, silver and gold, and the rows of silver and gold whose Ergast id is missing or
"nan". A session is complete when every stage succeeded, gold has its session row, the
driver counts agree from bronze results to gold and every id is real; a session that never
ran counts as a gap only once it started SETTLED ago. Prints a per-season summary, every
gap and the rounds whose ids need a silver + gold rebuild; exits 1 if there is a gap. Reads
through the SQL warehouse: one query per table
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
SETTLED = timedelta(hours=6)  # a session younger than this may not have been run yet
# an Ergast id FastF1 could not match; rows written before the silver fix keep "nan"
BAD_ID = "({c} IS NULL OR {c} IN ('', 'nan'))"
# a bad id is a gap when bronze has the real one elsewhere in the round, so a rebuild from
# silver fixes it; a driver with no id in any session of the round (a practice-only
# reserve) is only counted, in <table>_unmatched
BAD_ID_COLS = [f"{t}_bad_{c}_id" for t in ("silver", "gold") for c in ("driver", "constructor")]
UNMATCHED_COLS = ["silver_unmatched", "gold_unmatched"]

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
    """every session of the given seasons that has started; `settled` once it started SETTLED ago"""
    rows = []
    for season in seasons:
        schedule = fastf1.get_event_schedule(season, include_testing=False)
        for _, event in schedule.iterrows():
            for i in range(1, 6):
                name, start = event[f"Session{i}"], event[f"Session{i}DateUtc"]
                if name in SESSION_IDS and pd.notna(start) and start.tz_localize("UTC") < now:
                    rows.append({"season": season, "round": int(event["RoundNumber"]),
                                 "session_id": SESSION_IDS[name], "event": event["EventName"],
                                 "settled": start.tz_localize("UTC") + SETTLED < now})
    return pd.DataFrame(rows, columns=[*KEY, "event", "settled"])


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
    real = lambda col: f"MAX(CASE WHEN NOT {BAD_ID.format(c=col)} THEN {col} END)"
    known = f"""SELECT season, round, Abbreviation AS driver, {real("DriverId")} AS driver_id,
                       {real("TeamId")} AS constructor_id
                FROM race_preds.bronze.results WHERE season IN {_seasons_in(seasons)}
                GROUP BY season, round, Abbreviation"""
    bad = lambda col: BAD_ID.format(c=f"t.{col}")
    for prefix, table in (("silver", "race_preds.silver.results"), ("gold", "race_preds.gold.driver_session")):
        ids = lh.query(f"""SELECT t.season, t.round, t.session_id,
                                  COUNT_IF({bad("driver_id")} AND k.driver_id IS NOT NULL) AS {prefix}_bad_driver_id,
                                  COUNT_IF({bad("constructor_id")} AND k.constructor_id IS NOT NULL)
                                      AS {prefix}_bad_constructor_id,
                                  COUNT_IF({bad("driver_id")} AND k.driver_id IS NULL) AS {prefix}_unmatched
                           FROM {table} t LEFT JOIN ({known}) k
                             ON t.season = k.season AND t.round = k.round AND t.driver = k.driver
                           WHERE t.season IN {_seasons_in(seasons)}
                           GROUP BY t.season, t.round, t.session_id""")
        out = out.merge(ids, on=KEY, how="outer")
    return out


def states(seasons: list[int]) -> pd.DataFrame:
    """ops.processed_sessions pivoted to one column per stage, plus the first error"""
    df = lh.query(f"""SELECT season, round, session_id, stage, status, error
                      FROM race_preds.ops.processed_sessions WHERE season IN {_seasons_in(seasons)}""")
    wide = df.pivot_table(index=KEY, columns="stage", values="status", aggfunc="first")
    wide = wide.reindex(columns=STAGES).reset_index()
    order = df["stage"].map({s: i for i, s in enumerate(STAGES)})  # the first stage that failed
    errors = (df[df["status"] != "succeeded"].assign(order=order).sort_values("order")
              .groupby(KEY)["error"].first().str.slice(0, 120).rename("error").reset_index())
    return wide.merge(errors, on=KEY, how="left")


def problems(row: pd.Series) -> list[str]:
    """why one session is not complete; empty when it is"""
    if pd.isna(row["event"]):
        return ["in the lakehouse but not on the schedule"]
    found = []
    stages = {s: row[s] for s in STAGES if pd.notna(row[s])}
    if not stages:
        if row["settled"]:
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
    bad = {c.removesuffix("_id").replace("_bad_", " "): int(row[c]) for c in BAD_ID_COLS if row[c] > 0}
    if bad:
        found.append("missing or \"nan\" ids: " + ", ".join(f"{c} {n}" for c, n in bad.items()))
    return found


def verify(seasons: list[int], now: datetime) -> pd.DataFrame:
    table = (scheduled(seasons, now)
             .merge(states(seasons), on=KEY, how="outer")
             .merge(counts(seasons), on=KEY, how="outer"))
    num = [c for c in table.columns if c.endswith(("_rows", "_drivers")) or c in BAD_ID_COLS + UNMATCHED_COLS]
    table[num] = table[num].fillna(0).astype(int)
    table["problems"] = table.apply(lambda r: "; ".join(problems(r)), axis=1)
    return table.sort_values(KEY).reset_index(drop=True)


def bad_id_sessions(table: pd.DataFrame) -> list[tuple[int, int, str]]:
    """(season, round, session_id) with an id a rebuild from silver on would fix"""
    bad = table[(table[BAD_ID_COLS] > 0).any(axis=1)]
    return sorted((int(s), int(r), sid) for s, r, sid in zip(bad["season"], bad["round"], bad["session_id"]))


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
    s["unmatched_ids"] = table.groupby("season")["silver_unmatched"].sum()
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
        print("\nsessions to rebuild from silver for their ids:", bad_id_sessions(result) or "none")
    if (result["problems"] != "").any():
        raise SystemExit(1)
