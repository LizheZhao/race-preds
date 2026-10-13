"""Shared paths and FastF1 cache setup.

Every notebook and pipeline script starts from here so the cache location and
season constants are defined in exactly one place.
"""

from pathlib import Path

import fastf1

ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "fastf1_cache"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
MODEL_DIR = ROOT / "models"
OUTPUT_DIR = ROOT / "outputs"
# published v1 tree (index.json, <season>/<round>/...); web/ copies it with `npm run data`
SITE_DIR = OUTPUT_DIR / "site" / "v1"
# circuit geometry (outline, corners, lap length), reference data built once per circuit.
# Committed: the F1 live timing host refuses GitHub runners, so publish there can't build it
CIRCUIT_DIR = ROOT / "reference" / "circuits"

# Season the dashboard currently reports on.
SEASON = 2025

# History window for training. 2018 is the first season with full FastF1
# timing coverage (lap/telemetry data before that is patchy).
FIRST_TIMING_SEASON = 2018


def enable_cache(verbose: bool = True, cache_dir: Path | str | None = None) -> Path:
    """
    point FastF1 at an on-disk cache

    locally: create the repo's data/models/outputs dirs and use data/fastf1_cache
    in a Databricks job: pass a Volume path, the job's local disk is wiped after each run
    """
    if cache_dir is None:
        for directory in (CACHE_DIR, RAW_DIR, PROCESSED_DIR, MODEL_DIR, OUTPUT_DIR):
            directory.mkdir(parents=True, exist_ok=True)
        cache_dir = CACHE_DIR
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    fastf1.Cache.enable_cache(str(cache_dir))
    if verbose:
        print(f"FastF1 {fastf1.__version__} | cache -> {cache_dir}")
    return cache_dir
