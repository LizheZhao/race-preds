"""
aggregations over silver laps and gold sessions that publish puts on the dashboard:
neutralisation periods, measured tyre degradation, pit loss, wet-tyre share and the
weather climatology of a circuit (docs/dashboard-data-needs.md)

pure pandas, no IO: src/publish/lakehouse.py reads the rows, documents.py publishes the result
"""
import numpy as np
import pandas as pd

DRY = ["SOFT", "MEDIUM", "HARD"]
WET = ["INTERMEDIATE", "WET"]

# same fuel prior as src/etl/silver.py, which corrects race and sprint laps only. A practice
# long run is corrected as if it burns a race's fuel per lap from the start of the stint
FUEL_S_PER_KG = 0.03
START_FUEL_KG_TO_2025, START_FUEL_KG_FROM_2026 = 110.0, 70.0
RACE_LAPS_TYPICAL = 57

LONG_RUN_LAPS = 5  # clean laps a stint needs to count as a long run
TRAFFIC = 1.05  # a lap slower than this times its stint median is traffic or a mistake, not wear
MIN_STINTS, MIN_LAPS = 3, 30  # evidence a compound needs before its curve is published
WET_RACE_SHARE = 0.05  # a race with at least this share of laps on wet tyres counts as wet
PIT_LOSS_RANGE_S = (5.0, 60.0)  # outside it, the stop had a penalty, damage or a timing gap
MIN_STOPS = 5


# ---------------------------------------------------------------- neutralisation periods


def neutralisations(per_lap: pd.DataFrame) -> pd.DataFrame:
    """
    per_lap: one row per race lap (season, round, lap_number, sc, vsc, red), each flag true
    when that status was active during the lap
    -> one row per period (season, round, kind, start_lap, end_lap), kind SC | VSC | RED
    """
    out = []
    for (season, rnd), laps in per_lap.sort_values("lap_number").groupby(["season", "round"]):
        for kind, col in (("SC", "sc"), ("VSC", "vsc"), ("RED", "red")):
            on = laps.loc[laps[col].astype(bool), "lap_number"].astype(int).to_numpy()
            if not len(on):
                continue
            breaks = np.flatnonzero(np.diff(on) > 1)
            starts, ends = np.r_[on[0], on[breaks + 1]], np.r_[on[breaks], on[-1]]
            out += [{"season": int(season), "round": int(rnd), "kind": kind, "start_lap": int(a), "end_lap": int(b)}
                    for a, b in zip(starts, ends)]
    return pd.DataFrame(out, columns=["season", "round", "kind", "start_lap", "end_lap"])


# ---------------------------------------------------------------- tyre degradation


def _fuel_corrected(laps: pd.DataFrame) -> pd.Series:
    """race and sprint laps are fuel-corrected in silver; practice laps get the same prior here"""
    start = np.where(laps["season"] >= 2026, START_FUEL_KG_FROM_2026, START_FUEL_KG_TO_2025)
    burnt = FUEL_S_PER_KG * start / RACE_LAPS_TYPICAL * (laps["stint_lap"] - 1)
    return laps["lap_time_fuel_corr_s"].fillna(laps["lap_time_s"] + burnt)


def long_runs(laps: pd.DataFrame) -> pd.DataFrame:
    """
    laps: silver laps (season, round, session_id, driver, stint, stint_lap, compound,
    tyre_life, lap_time_s, lap_time_fuel_corr_s), already limited to clean timed laps
    -> the dry-compound laps of stints with at least LONG_RUN_LAPS of them, traffic dropped,
    with `time_s` fuel-corrected and a `run` key per stint
    """
    laps = laps[laps["compound"].isin(DRY) & laps["tyre_life"].notna() & laps["lap_time_s"].notna()].copy()
    laps["run"] = laps[["season", "round", "session_id", "driver", "stint"]].astype(str).agg("/".join, axis=1)
    laps["time_s"] = _fuel_corrected(laps)
    laps = laps[laps["time_s"] <= laps.groupby("run")["time_s"].transform("median") * TRAFFIC]
    return laps[laps.groupby("run")["time_s"].transform("size") >= LONG_RUN_LAPS]


def degradation(laps: pd.DataFrame) -> list[dict]:
    """
    per dry compound with enough long runs: lap time loss vs tyre age 1, fitted as
    b1 (age - 1) + b2 (age - 1)^2 with one intercept per stint (within-stint demeaning), so
    a stint's base pace and fuel load drop out and only the shape over age is pooled.
    Ages run from 1 to the 90th percentile of the ages observed
    """
    runs = long_runs(laps)
    curves = []
    for compound in DRY:
        c = runs[runs["compound"] == compound]
        if c["run"].nunique() < MIN_STINTS or len(c) < MIN_LAPS:
            continue
        age = c["tyre_life"].astype(float) - 1
        x = pd.DataFrame({"a": age, "a2": age ** 2})
        x = x - x.groupby(c["run"]).transform("mean")
        y = c["time_s"] - c.groupby("run")["time_s"].transform("mean")
        (b1, b2), *_ = np.linalg.lstsq(x.to_numpy(), y.to_numpy(), rcond=None)
        top = int(np.percentile(c["tyre_life"], 90))
        life = list(range(1, max(top, 2) + 1))
        curves.append({"compound": compound, "tyre_life": life,
                       "lap_delta_s": [round(float(b1 * (a - 1) + b2 * (a - 1) ** 2), 3) for a in life],
                       "source_sessions": sorted(c["session_id"].unique().tolist()),
                       "seasons": sorted(int(s) for s in c["season"].unique()),
                       "stints": int(c["run"].nunique())})
    return curves


# ---------------------------------------------------------------- pit loss


def pit_stops(laps: pd.DataFrame) -> pd.DataFrame:
    """
    laps: silver race laps (season, round, driver, lap_number, lap_time_s, track_status,
    is_in_lap, is_out_lap, is_clean, is_deleted)
    -> one row per green-flag stop: in-lap plus out-lap against twice the driver's median
    clean lap. A stop under SC or VSC, on lap 1 or with a missing lap time is left out
    """
    key = ["season", "round", "driver"]
    laps = laps.sort_values([*key, "lap_number"])
    clean = laps[laps["is_clean"].eq(True) & ~laps["is_deleted"].eq(True)]
    median = clean.groupby(key)["lap_time_s"].median().rename("median_s")
    nxt = laps.groupby(key)[["lap_number", "lap_time_s", "track_status", "is_out_lap"]].shift(-1)
    stops = laps.assign(out_number=nxt["lap_number"], out_time_s=nxt["lap_time_s"],
                        out_status=nxt["track_status"], out_lap=nxt["is_out_lap"].eq(True))
    stops = stops[stops["is_in_lap"].eq(True) & stops["out_lap"] & (stops["out_number"] == stops["lap_number"] + 1)
                  & (stops["lap_number"] > 1) & (stops["track_status"] == "1") & (stops["out_status"] == "1")]
    stops = stops.join(median, on=key).dropna(subset=["lap_time_s", "out_time_s", "median_s"])
    stops = stops.assign(loss_s=stops["lap_time_s"] + stops["out_time_s"] - 2 * stops["median_s"])
    lo, hi = PIT_LOSS_RANGE_S
    return stops[stops["loss_s"].between(lo, hi)][[*key, "lap_number", "loss_s"]]


def pit_loss(laps: pd.DataFrame) -> dict | None:
    """median green-flag pit loss over the given races, or None with fewer than MIN_STOPS stops"""
    stops = pit_stops(laps)
    if len(stops) < MIN_STOPS:
        return None
    return {"pit_loss_s": round(float(stops["loss_s"].median()), 1), "stops": len(stops),
            "seasons": sorted(int(s) for s in stops["season"].unique())}


# ---------------------------------------------------------------- weather


def wet_tyre_share(compounds: pd.DataFrame) -> pd.DataFrame:
    """
    compounds: lap counts per session and compound (season, round, session_id, compound, laps)
    -> season, round, session_id, wet_tyre_share: the share of laps on INTERMEDIATE or WET
    among laps with a known compound
    """
    key = ["season", "round", "session_id"]
    known = compounds[compounds["compound"].isin(DRY + WET)]
    wet = known.assign(wet=known["laps"].where(known["compound"].isin(WET), 0)).groupby(key)[["wet", "laps"]].sum()
    return (wet["wet"] / wet["laps"]).rename("wet_tyre_share").reset_index()


def climatology(races: pd.DataFrame) -> dict | None:
    """
    races: gold.session rows of earlier races here, with `wet_tyre_share` joined on
    -> seasons, wet race share (any rainfall, or WET_RACE_SHARE of laps on wet tyres) and
    mean air and track temperature; None when there is no earlier race, or no usable
    temperature reading in any of them
    """
    if races.empty:
        return None
    wet = (races["rain_frac"].fillna(0) > 0) | (races["wet_tyre_share"].fillna(0) >= WET_RACE_SHARE)
    air = races["air_temp_mean"].mean()
    track = races["track_temp_mean"].where(races["track_temp_mean"] > 0).mean()  # a dropped sensor reads 0.0
    if pd.isna(air) or pd.isna(track):
        return None
    return {"seasons": sorted(int(s) for s in races["season"].unique()), "wet_race_share": float(wet.mean()),
            "air_temp_c_mean": round(float(air), 1), "track_temp_c_mean": round(float(track), 1)}
