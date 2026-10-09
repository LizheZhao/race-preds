"""
lap filters on a plain laps DataFrame, the future silver lap flags

these replace FastF1's Laps.pick_* methods, which only exist on a FastF1 Laps object
and not on the tables ingest writes or Spark hands to applyInPandas
"""
import pandas as pd

# same default as fastf1.core.Laps.QUICKLAP_THRESHOLD
QUICKLAP_THRESHOLD = 1.07


def not_deleted(laps: pd.DataFrame) -> pd.DataFrame:
    """laps not deleted by race control (track limits etc.)"""
    return laps[~laps["Deleted"]]


def clean_laps(laps: pd.DataFrame) -> pd.DataFrame:
    """no pit in/out, green flag throughout (TrackStatus exactly "1"), accurate timing"""
    return laps[laps["PitInTime"].isna() & laps["PitOutTime"].isna()
                & (laps["TrackStatus"] == "1") & laps["IsAccurate"]]


def quick_laps(laps: pd.DataFrame, threshold: float = QUICKLAP_THRESHOLD) -> pd.DataFrame:
    """laps within threshold of the fastest lap in `laps`, so the result depends on what was filtered before"""
    return laps[laps["LapTime"] < laps["LapTime"].min() * threshold]
