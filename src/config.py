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

# Season the dashboard currently reports on.
SEASON = 2025

# History window for training. 2018 is the first season with full FastF1
# timing coverage (lap/telemetry data before that is patchy).
FIRST_TIMING_SEASON = 2018


def enable_cache(verbose: bool = True) -> Path:
    """Create the local dirs and point FastF1 at the on-disk cache."""
    for directory in (CACHE_DIR, RAW_DIR, PROCESSED_DIR, MODEL_DIR, OUTPUT_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    fastf1.Cache.enable_cache(str(CACHE_DIR))
    if verbose:
        print(f"FastF1 {fastf1.__version__} | cache -> {CACHE_DIR.relative_to(ROOT)}")
    return CACHE_DIR
