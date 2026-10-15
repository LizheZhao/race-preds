"""
backfill past rounds into the lakehouse with the backfill_round bundle job, one round at a
time, newest first, timing each (docs/pipeline-plan.md, Phase 3 plan step 1)

    python -m src.dispatch.backfill 2026 14            # one round
    python -m src.dispatch.backfill 2025 1-24          # a season, run as 24, 23, ... 1
    python -m src.dispatch.backfill 2025 3,7 --redo    # rebuild rounds already in gold

Thursday to Monday (UTC) belongs to the live dispatcher: an over-quota day would stop the
race weekend, so the backfill refuses to start then unless --anyday is given
"""
import argparse
import time
from datetime import datetime, timedelta, timezone

from databricks.sdk.errors import OperationFailed

from src.dispatch import jobs

JOB_NAME = "backfill_round"
ROUND_TIMEOUT = timedelta(hours=2)
BACKFILL_DAYS = {1, 2}  # Tuesday, Wednesday (Monday = 0)


def parse_rounds(spec: str) -> list[int]:
    """'1-24', '3,7' or '14' -> rounds, newest first"""
    rounds = set()
    for part in spec.split(","):
        lo, _, hi = part.partition("-")
        rounds.update(range(int(lo), int(hi or lo) + 1))
    return sorted(rounds, reverse=True)


def backfill_round(season: int, rnd: int, redo: bool = False) -> tuple[bool, float]:
    """run one round and wait; returns (succeeded, minutes)"""
    params = {"season": str(season), "round": str(rnd), "redo": str(redo).lower()}
    started = time.monotonic()
    try:
        jobs._client().jobs.run_now(job_id=jobs._job_id(JOB_NAME), job_parameters=params).result(timeout=ROUND_TIMEOUT)
        ok = True
    except OperationFailed:
        ok = False  # the state table says which session failed and why
    return ok, (time.monotonic() - started) / 60


def main(season: int, rounds: list[int], redo: bool) -> list[int]:
    """returns the rounds that didn't finish; re-running them skips what did"""
    unfinished = []
    for rnd in rounds:
        try:
            ok, minutes = backfill_round(season, rnd, redo)
            states = jobs.statuses(season, rnd)
        except Exception as exc:  # a dropped connection to the workspace costs one round, not the batch
            print(f"{season} R{rnd:02d}  ERROR   {type(exc).__name__}: {str(exc)[:200]}", flush=True)
            unfinished.append(rnd)
            continue
        gold = sorted(sid for (sid, stage), s in states.items() if stage == "gold" and s == "succeeded")
        other = {f"{sid}/{stage}": s for (sid, stage), s in states.items() if s != "succeeded"}
        print(f"{season} R{rnd:02d}  {'ok    ' if ok else 'FAILED'}  {minutes:5.1f} min  gold {gold}"
              + (f"  {other}" if other else ""), flush=True)
        if not ok:
            unfinished.append(rnd)
    if unfinished:
        print(f"{season}: re-run rounds {','.join(map(str, sorted(unfinished)))}")
    return unfinished


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("season", type=int)
    parser.add_argument("rounds", type=parse_rounds, help="e.g. 14, 1-24 or 3,7")
    parser.add_argument("--redo", action="store_true", help="rebuild sessions already in gold")
    parser.add_argument("--anyday", action="store_true", help="also run Thursday to Monday (UTC)")
    args = parser.parse_args()

    today = datetime.now(timezone.utc)
    if today.weekday() not in BACKFILL_DAYS and not args.anyday:
        raise SystemExit(f"{today:%A} UTC is a race-weekend day; backfill runs Tuesday and Wednesday (--anyday to override)")
    if main(args.season, args.rounds, args.redo):
        raise SystemExit(1)
