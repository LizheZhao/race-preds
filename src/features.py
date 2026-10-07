import pandas as pd

FEATURE_COLS = ["best_lap_gap_pct", "ideal_lap_gap_pct", "team_gap_pct", "best_lap_rank",
                "top_speed_rank", "laps_driven", "clean_lap_median", "clean_lap_std"]


def weekend_features(summaries, sessions):
    """one row per driver: FEATURE_COLS from each available session, prefixed with its id"""
    parts = [summaries[sid][0].set_index("Driver")[FEATURE_COLS].add_prefix(f"{sid.lower()}_")
             for sid in sessions if sid in summaries]
    return pd.concat(parts, axis=1)
