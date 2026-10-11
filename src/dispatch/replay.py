"""
replay a past weekend through the dispatcher with a fake clock: the Thursday build, then
each session as soon as its data would have been available

    python -m src.dispatch.replay 2026 15            # into outputs/site/v1, round directory cleared first
    python -m src.dispatch.replay 2026 15 --keep     # keep what is already published for the round
"""
import argparse
import logging
import shutil
import warnings
from pathlib import Path

from src import schema
from src.config import SITE_DIR, enable_cache
from src.dispatch.dispatcher import dispatch, pre_weekend_at, ready_at
from src.sessions import get_sessions


def replay(season: int, rnd: int, site: Path, keep: bool = False) -> list[str]:
    round_dir = site / schema.round_dir(season, rnd)
    if round_dir.exists() and not keep:
        shutil.rmtree(round_dir)

    clock = [pre_weekend_at(season, rnd)] + [ready_at(s) for s in get_sessions(season, rnd)]
    published = []
    for now in clock:
        run_id = f"replay-{now:%Y%m%dT%H%MZ}"
        print(f"{now:%a %Y-%m-%d %H:%M} UTC")
        published.append(dispatch(season, rnd, now.to_pydatetime(), site, run_id))

    problems = schema.check_round(round_dir)
    for problem in problems:
        print(f"x {problem}")
    print(f"{round_dir}: {'OK' if not problems else f'{len(problems)} problem(s)'}, stages {published}")
    if problems:
        raise SystemExit(1)
    return published


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("season", type=int)
    parser.add_argument("round", type=int)
    parser.add_argument("--site", type=Path, default=SITE_DIR)
    parser.add_argument("--keep", action="store_true", help="do not clear the round directory first")
    args = parser.parse_args()

    enable_cache(verbose=False)
    logging.getLogger("fastf1").setLevel(logging.ERROR)
    warnings.filterwarnings("ignore")
    replay(args.season, args.round, args.site, args.keep)
