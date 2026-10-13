"""
the scheduled dispatcher run: find the round whose weekend window holds the clock, bring
the lakehouse up to date, and publish only when something changed

    python -m src.dispatch.run --site outputs/site/v1
    python -m src.dispatch.run --site outputs/site/v1 --round 17 --now 2026-10-11T16:00Z

writes changed=true|false and stage=<stage> to $GITHUB_OUTPUT when it is set. A failed
session job publishes the last complete stage first, then exits non-zero
"""
import argparse
import logging
import os
import warnings
from datetime import datetime, timezone
from pathlib import Path

import fastf1
import pandas as pd

from src import schema
from src.config import SITE_DIR, enable_cache
from src.dispatch.dispatcher import Progress, pre_weekend_at, process, publish_stage, ready_at
from src.sessions import get_sessions

WINDOW_TAIL = pd.Timedelta(hours=24)  # after the race is ready: post-race penalties change the classification
WEATHER_EVERY = pd.Timedelta(hours=3)


def window(season: int, rnd: int) -> tuple[pd.Timestamp, pd.Timestamp]:
    return pre_weekend_at(season, rnd), ready_at(get_sessions(season, rnd)[-1]) + WINDOW_TAIL


def current_round(season: int, now: datetime) -> int | None:
    """the round whose window holds `now`; windows never overlap, a race's ends before the next Thursday build"""
    schedule = fastf1.get_event_schedule(season, include_testing=False)
    near = schedule[(schedule["EventDate"] - pd.Timestamp(now).tz_localize(None)).abs() <= pd.Timedelta(days=7)]
    for rnd in near["RoundNumber"]:
        start, end = window(season, int(rnd))
        if start <= now < end:
            return int(rnd)
    return None


def reasons(progress: Progress, manifest: schema.RaceManifest | None, now: datetime) -> list[str]:
    """why this run must publish; empty when the published round is already current"""
    if manifest is None:
        return ["first build of the round"]
    why = []
    if progress.stage != manifest.meta.stage:
        why.append(f"stage {manifest.meta.stage} -> {progress.stage}")
    if progress.processed:
        why.append(f"processed {', '.join(progress.processed)}")
    weather = manifest.sections["weather"].updated_at
    if weather is None or now - weather >= WEATHER_EVERY:
        why.append("weather due")
    return why


def run(site: Path, now: datetime, rnd: int | None = None) -> tuple[bool, str | None]:
    """returns (published, stage)"""
    season = now.year
    rnd = rnd or current_round(season, now)
    if rnd is None:
        print(f"{now:%Y-%m-%d %H:%M} UTC: no race weekend window, nothing to do")
        return False, None

    print(f"{now:%a %Y-%m-%d %H:%M} UTC: {season} R{rnd}")
    progress = process(season, rnd, now)
    if progress is None:
        print("  before the Thursday build, nothing to do")
        return False, None

    path = site / schema.round_dir(season, rnd) / "manifest.json"
    manifest = schema.load(path, "manifest") if path.exists() else None
    why = reasons(progress, manifest, now)
    if why:
        print(f"  publishing: {'; '.join(why)}")
        run_id = f"gh-{os.environ['GITHUB_RUN_ID']}" if "GITHUB_RUN_ID" in os.environ else f"local-{now:%Y%m%dT%H%MZ}"
        publish_stage(season, rnd, progress.stage, now, site, run_id)
    else:
        print(f"  {progress.stage} is already published, nothing changed")

    _output(changed=str(bool(why)).lower(), stage=progress.stage)
    if progress.error:
        raise progress.error
    return bool(why), progress.stage


def _output(**values: str) -> None:
    if "GITHUB_OUTPUT" not in os.environ:
        return
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.writelines(f"{k}={v}\n" for k, v in values.items())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", type=Path, default=SITE_DIR)
    parser.add_argument("--now", type=pd.Timestamp, help="clock override, e.g. 2026-10-11T16:00Z")
    parser.add_argument("--round", type=int, help="skip the window lookup")
    args = parser.parse_args()

    now = args.now.tz_localize("UTC") if args.now and args.now.tzinfo is None else args.now
    now = now.to_pydatetime() if now is not None else datetime.now(timezone.utc)
    enable_cache(verbose=False)
    logging.getLogger("fastf1").setLevel(logging.ERROR)
    warnings.filterwarnings("ignore")
    run(args.site, now, args.round)
