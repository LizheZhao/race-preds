import pandas as pd
from scipy.stats import theilslopes

MIN_STINT_LAPS = 8


def long_runs(session, min_laps=MIN_STINT_LAPS):
    """one row per clean stint of min_laps+ laps: median pace and degradation slope"""
    clean = session.laps.pick_wo_box().pick_track_status("1").pick_accurate().pick_not_deleted()
    clean = clean.assign(lap_s=clean["LapTime"].dt.total_seconds())

    # cool-down laps stay green and accurate, so filter them against the stint median
    stint_median = clean.groupby(["Driver", "Stint"])["lap_s"].transform("median")
    clean = clean[clean["lap_s"] <= stint_median * 1.03]

    rows = []
    for (driver, stint), g in clean.groupby(["Driver", "Stint"]):
        if len(g) < min_laps:
            continue
        rows.append({
            "Driver": driver,
            "Stint": int(stint),
            "Compound": g["Compound"].iloc[0],
            "laps": len(g),
            "median_lap_s": g["lap_s"].median(),
            "deg_s_per_lap": theilslopes(g["lap_s"], g["TyreLife"])[0],
        })
    return pd.DataFrame(rows)
