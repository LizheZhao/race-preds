"""
baseline models: the simplest predictions that fill every schema field, so the whole
chain (lakehouse -> publish -> site) runs before the real models exist. Each one is the
bar its replacement has to beat (docs/pipeline-plan.md, Part 2). Pure functions, no IO

probabilities: an ordering becomes a position matrix by mixing the permutation with the
uniform matrix, P = (1 - eps) * perm + eps / n. Every row and every column sums to 1, as
the schema requires for qualifying; finishing order scales each row by (1 - p_dnf)
"""
from itertools import product

import numpy as np
import pandas as pd

ORDER_UNCERTAINTY = 0.5  # eps: weight of the uniform matrix

# race incident prior, a pseudo-season of races the observed history is pooled with
PRIOR_RACES = 10
PRIOR_P_SC, PRIOR_P_VSC, PRIOR_P_RED, PRIOR_SC_PER_RACE = 0.55, 0.45, 0.10, 0.9
START_WINDOW_LAPS = 5  # first lap window, where first-lap incidents bunch

# tyre prior: pace vs MEDIUM (s/lap), degradation (s/lap per lap of tyre age), longest stint
COMPOUNDS = {"SOFT": (-0.5, 0.10, 22), "MEDIUM": (0.0, 0.06, 32), "HARD": (0.35, 0.04, 45)}
PIT_LOSS_S = 22.0
PIT_WINDOW_S = 1.0  # a pit lap is in the window when it costs at most this much over the best
MAX_OPTIONS = 4


def order_matrix(n: int, eps: float = ORDER_UNCERTAINTY) -> np.ndarray:
    """row i: position probabilities of the driver predicted i-th"""
    return (1 - eps) * np.eye(n) + eps / n


# ---------------------------------------------------------------- qualifying and finishing order


def quali_order(driver_ids: list[str], team_of: dict[str, str], quali_history: pd.DataFrame) -> list[str]:
    """
    order by mean qualifying position this season; a driver with no history takes the
    team-mate's mean, else the back of the field; ties keep the entry-list order
    """
    mean = quali_history.groupby("driverId")["position"].mean() if len(quali_history) else pd.Series(dtype=float)
    team_mean = {t: mean.reindex([d for d in driver_ids if team_of[d] == t]).mean() for t in set(team_of.values())}
    back = len(driver_ids)
    score = {d: mean.get(d, team_mean[team_of[d]]) for d in driver_ids}
    score = {d: back if pd.isna(s) else s for d, s in score.items()}
    return sorted(driver_ids, key=lambda d: (score[d], driver_ids.index(d)))


def qualifying(order: list[str]) -> list[dict]:
    probs = order_matrix(len(order))
    return [{"driver_id": d, "position_probs": probs[i].tolist()} for i, d in enumerate(order)]


def dnf_rate(race_history: pd.DataFrame) -> float:
    """share of starters not classified this season (positionText not a number), clipped"""
    if race_history.empty:
        return 0.08
    classified = race_history["positionText"].astype(str).str.isdigit()
    return float(np.clip(1 - classified.mean(), 0.02, 0.3))


def finishing_order(order: list[str], p_dnf: float, grid: dict[str, int] | None = None) -> list[dict]:
    probs = order_matrix(len(order)) * (1 - p_dnf)
    return [{"driver_id": d, "grid_position": (grid or {}).get(d), "position_probs": probs[i].tolist(),
             "p_dnf": p_dnf} for i, d in enumerate(order)]


# ---------------------------------------------------------------- race incidents


def race_incidents(history: pd.DataFrame, race_laps: int) -> dict:
    """
    league-wide rates from the races in the lakehouse (gold.session rows), pooled with the
    prior; the safety car is spread over the race as a Poisson process, uniform per lap
    """
    n = len(history)
    rate = lambda col, prior: (float((history[col] > 0).sum()) + prior * PRIOR_RACES) / (n + PRIOR_RACES) if n else prior
    p_sc, p_vsc, p_red = rate("sc_n", PRIOR_P_SC), rate("vsc_n", PRIOR_P_VSC), rate("red_n", PRIOR_P_RED)
    expected = ((float(history["sc_n"].sum()) if n else 0.0) + PRIOR_SC_PER_RACE * PRIOR_RACES) / (n + PRIOR_RACES)
    expected = max(expected, p_sc)  # E[N] >= P(N >= 1) for a count

    hazard = -np.log(1 - p_sc)  # SC starts per race
    bounds = [1, min(START_WINDOW_LAPS, race_laps) + 1]
    rest = race_laps - bounds[-1] + 1
    if rest > 0:
        bounds += [bounds[-1] + round(rest * k / 4) for k in range(1, 5)]
    bounds = sorted(set(bounds))
    windows = [{"start_lap": a, "end_lap": b - 1,
                "p_safety_car": float(1 - np.exp(-hazard * (b - a) / race_laps))}
               for a, b in zip(bounds, bounds[1:])]
    return {"p_safety_car": p_sc, "p_vsc": p_vsc, "p_red_flag": p_red,
            "expected_safety_cars": expected, "by_lap_window": windows, "races_used": n}


# ---------------------------------------------------------------- strategy


def _stint_time(compound: str, laps: int) -> float:
    pace, deg, _ = COMPOUNDS[compound]
    return laps * pace + deg * laps * (laps - 1) / 2


def _plans() -> list[tuple[str, ...]]:
    """every 1- and 2-stop compound sequence using at least two dry compounds"""
    return [s for k in (2, 3) for s in product(COMPOUNDS, repeat=k)
            if len(set(s)) >= 2 and all(a != b for a, b in zip(s, s[1:]))]


def _best_split(seq: tuple[str, ...], race_laps: int):
    """stint lengths minimising race time, within each compound's longest stint"""
    caps = [COMPOUNDS[c][2] for c in seq]
    best, best_lengths, costs = None, None, {}
    if len(seq) == 2:
        candidates = ((a, race_laps - a) for a in range(1, race_laps))
    else:
        candidates = ((a, b, race_laps - a - b) for a in range(1, race_laps) for b in range(1, race_laps - a))
    for lengths in candidates:
        if any(n > cap or n < 1 for n, cap in zip(lengths, caps)):
            continue
        t = sum(_stint_time(c, n) for c, n in zip(seq, lengths)) + PIT_LOSS_S * (len(seq) - 1)
        costs[lengths] = t
        if best is None or t < best:
            best, best_lengths = t, lengths
    return best, best_lengths, costs


def strategy(race_laps: int) -> dict:
    """the fastest compound sequences under the tyre prior, best first, with pit windows"""
    found = []
    for seq in _plans():
        t, lengths, costs = _best_split(seq, race_laps)
        if t is None:
            continue
        ends = np.cumsum(lengths)
        stints = [{"compound": c, "start_lap": int(e - n + 1), "end_lap": int(e)} for c, n, e in zip(seq, lengths, ends)]
        # pit window of stop k: laps where that stop can sit with the other stops fixed at the optimum
        windows = []
        for k in range(len(seq) - 1):
            ok = [int(np.cumsum(l)[k]) for l, ct in costs.items()
                  if ct <= t + PIT_WINDOW_S and all(l[j] == lengths[j] for j in range(len(l)) if j not in (k, k + 1))]
            windows.append({"stop": k + 1, "earliest_lap": min(ok), "latest_lap": max(ok)})
        found.append({"id": f"{len(seq) - 1}stop-" + "-".join(c[0].lower() for c in seq),
                      "time": t, "stints": stints, "pit_windows": windows})
    found.sort(key=lambda o: o["time"])
    best = found[0]["time"]
    options = [{**o, "expected_time_delta_s": round(o["time"] - best, 3)} for o in found[:MAX_OPTIONS]]
    degradation = [{"compound": c, "tyre_life": list(range(1, cap + 1)),
                    "lap_delta_s": [round(deg * (life - 1), 4) for life in range(1, cap + 1)], "source_sessions": []}
                   for c, (_, deg, cap) in COMPOUNDS.items()]
    return {"pit_loss_s": PIT_LOSS_S, "options": options, "degradation": degradation}
