"""
the MLflow face of a bundle: what Unity Catalog registers. Kept out of registry.py so that
publish, which only reads bundles, never imports MLflow
"""
from pathlib import Path

import mlflow.pyfunc
import pandas as pd


def flat(pred: pd.DataFrame) -> pd.DataFrame:
    """a candidate's prediction as plain columns: expected position, win (or pole) and DNF
    probability. probs covers the stage's n entrants, plus "not classified" for finishing
    order; qualifying has no such category, so its p_dnf is 0"""
    n = pred.groupby("stage")["driver_id"].transform("size").to_numpy()
    pos = [p[:k] for p, k in zip(pred["probs"], n)]
    return pd.DataFrame({"stage": pred["stage"], "driver_id": pred["driver_id"],
                         "expected_position": [float((p * range(1, len(p) + 1)).sum() / max(p.sum(), 1e-12)) for p in pos],
                         "p_win": [float(p[0]) for p in pos],
                         "p_dnf": [float(p[k]) if len(p) > k else 0.0 for p, k in zip(pred["probs"], n)]})


class PyfuncBundle(mlflow.pyfunc.PythonModel):
    """loads the bundle artifact; predicts gold.features rows of one round"""

    def load_context(self, context):
        from src.models.registry import read_bundle
        self.bundle = read_bundle(Path(context.artifacts["bundle"]))

    def predict(self, context, model_input: pd.DataFrame) -> pd.DataFrame:
        return flat(self.bundle.model.predict(model_input, model_input.iloc[:0]))
