"""
the MLflow face of a bundle: what Unity Catalog registers. Kept out of registry.py so that
publish, which only reads bundles, never imports MLflow
"""
from pathlib import Path

import mlflow.pyfunc
import pandas as pd


def flat(pred: pd.DataFrame) -> pd.DataFrame:
    """a candidate's prediction as plain columns: expected position, win and DNF probability"""
    n = len(pred["probs"].iloc[0]) - 1
    pos = pred["probs"].apply(lambda p: p[:n])
    return pd.DataFrame({"stage": pred["stage"], "driver_id": pred["driver_id"],
                         "expected_position": pos.apply(lambda p: float((p * range(1, n + 1)).sum() / max(p.sum(), 1e-12))),
                         "p_win": pos.apply(lambda p: float(p[0])),
                         "p_dnf": pred["probs"].apply(lambda p: float(p[n]))})


class PyfuncBundle(mlflow.pyfunc.PythonModel):
    """loads the bundle artifact; predicts gold.features rows of one round"""

    def load_context(self, context):
        from src.models.registry import read_bundle
        self.bundle = read_bundle(Path(context.artifacts["bundle"]))

    def predict(self, context, model_input: pd.DataFrame) -> pd.DataFrame:
        return flat(self.bundle.model.predict(model_input, model_input.iloc[:0]))
