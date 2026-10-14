"""
every candidate model behind the harness interface (src/models/evaluate.py)

    name, section        section: finishing_order | qualifying
    fit(train)           gold.features rows before the fold's cut-off
    predict(rows, history) -> DataFrame of stage, driver_id, probs
                         rows: one round, every stage of the section; history: one row per
                         driver and earlier round, with its labels (y_finish, y_classified, y_quali)

probs is a position distribution over the round's n entrants; finishing order appends one
more category, not classified. The baselines stay in CANDIDATES for good: they are the
floor every model has to clear (docs/pipeline-plan.md, Part 2)
"""
import numpy as np
import pandas as pd

from src.models import baselines


def _quali_order(rows: pd.DataFrame, history: pd.DataFrame) -> list[str]:
    """publish's qualifying order: mean qualifying position in this season's earlier rounds"""
    season = history[history["season"] == rows["season"].iat[0]]
    quali = season.rename(columns={"driver_id": "driverId", "y_quali": "position"})[["driverId", "position"]].dropna()
    roster = rows.drop_duplicates("driver_id").sort_values("driver_id")
    return baselines.quali_order(roster["driver_id"].tolist(), dict(zip(roster["driver_id"], roster["constructor_id"])), quali)


def _frame(stage: str, order: list[str], probs: np.ndarray) -> list[dict]:
    return [{"stage": stage, "driver_id": d, "probs": probs[i]} for i, d in enumerate(order)]


class QualiSeasonAverage:
    """publish's qualifying baseline"""
    name, section = "quali-season-average", "qualifying"

    def fit(self, train: pd.DataFrame) -> None:
        pass

    def predict(self, rows: pd.DataFrame, history: pd.DataFrame) -> pd.DataFrame:
        order = _quali_order(rows, history)
        probs = baselines.order_matrix(len(order))
        return pd.DataFrame([r for stage in rows["stage"].unique() for r in _frame(stage, order, probs)])


class GridOrder:
    """publish's finishing-order baseline: grid order once qualifying has run, else the
    qualifying baseline's order; one field-wide DNF rate from this season's earlier races"""
    name, section = "grid-order", "finishing_order"

    def fit(self, train: pd.DataFrame) -> None:
        pass

    def predict(self, rows: pd.DataFrame, history: pd.DataFrame) -> pd.DataFrame:
        season = history[(history["season"] == rows["season"].iat[0]) & history["y_classified"].notna()]
        p_dnf = baselines.dnf_rate(pd.DataFrame({"positionText": np.where(season["y_classified"] == True, "1", "R")}))
        base = _quali_order(rows, history)
        out = []
        for stage, g in rows.groupby("stage"):
            q = g.dropna(subset=["quali_position"])
            grid = dict(zip(q["driver_id"], q["quali_position"].astype(int)))
            order = sorted(base, key=lambda d: grid.get(d, len(base) + 1)) if grid else base
            positions = np.array([d["position_probs"] for d in baselines.finishing_order(order, p_dnf)])
            out += _frame(stage, order, np.column_stack([positions, np.full(len(order), p_dnf)]))
        return pd.DataFrame(out)


CANDIDATES = [GridOrder, QualiSeasonAverage]
