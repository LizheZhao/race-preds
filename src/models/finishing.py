"""
finishing order model (docs/pipeline-plan.md, Phase 3 plan step 4): a strength per driver,
a DNF probability per driver, then a Monte Carlo that turns both into a position
distribution with a "not classified" category

    strength   ridge regression of finishing position on gold.features; a missing feature
               gets an indicator, so one model serves every stage (grid only after Q, ...)
    DNF        logistic regression on the driver's and the team's recent DNF rates
    simulate   retirements first, then a Plackett-Luce order of the rest, drawn with the
               Gumbel trick; the temperature is fitted on out-of-fold strengths, so the
               spread is what the model earns out of sample, not in it

pure numpy / scikit-learn, so publish can score it without Spark
"""
import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

STRENGTH_FEATURES = [
    "practice_gap_pct", "practice_team_gap_pct", "sq_best_lap_gap_pct", "s_best_lap_gap_pct",
    "q_best_lap_gap_pct", "quali_position", "grid_position",
    "form_finish", "form_quali", "form_finish_season", "form_finish_prev_season", "team_form_finish",
]
DNF_FEATURES = ["dnf_rate", "team_dnf_rate"]
SIMULATIONS = 4000
SEED = 2026
FOLDS = 5


def _strength_model():
    return make_pipeline(SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True),
                         StandardScaler(), Ridge(alpha=10.0))


def _pl_loglik(temperature: float, groups: list[np.ndarray]) -> float:
    """Plackett-Luce log likelihood of the observed orders; each group holds the strengths
    of one round-stage's classified drivers, best finisher first"""
    total = 0.0
    for s in groups:
        z = s / temperature
        tail = np.logaddexp.accumulate(z[::-1])[::-1]  # log sum over drivers not yet placed
        total += float(np.sum(z - tail))
    return total


class StrengthPL:
    name, section = "strength-pl", "finishing_order"
    features = STRENGTH_FEATURES + DNF_FEATURES

    def fit(self, train: pd.DataFrame) -> None:
        done = train[train["y_classified"].notna()]
        finished = done[done["y_classified"] == True]
        self.strength = _strength_model().fit(finished[STRENGTH_FEATURES], finished["y_finish"])

        # temperature from out-of-fold strengths, grouped by round so a round never predicts itself
        rounds = finished["season"] * 100 + finished["round"]
        k = min(FOLDS, rounds.nunique())
        oof = (cross_val_predict(_strength_model(), finished[STRENGTH_FEATURES], finished["y_finish"],
                                 groups=rounds, cv=GroupKFold(k)) if k >= 2 else
               self.strength.predict(finished[STRENGTH_FEATURES]))
        scored = finished.assign(s=-oof)
        groups = [g.sort_values("y_finish")["s"].to_numpy() for _, g in scored.groupby(["season", "round", "stage"])]
        self.temperature = minimize_scalar(lambda t: -_pl_loglik(t, groups), bounds=(0.05, 20), method="bounded").x

        y = (done["y_classified"] == False).astype(int)
        self.dnf = (make_pipeline(SimpleImputer(strategy="median", keep_empty_features=True), LogisticRegression(C=1.0))
                    .fit(done[DNF_FEATURES], y) if y.nunique() == 2 else float(y.mean()))

    def predict(self, rows: pd.DataFrame, history: pd.DataFrame) -> pd.DataFrame:
        rng = np.random.default_rng(SEED)
        out = []
        for stage, g in rows.groupby("stage"):
            g = g.sort_values("driver_id")
            n = len(g)
            strength = -self.strength.predict(g[STRENGTH_FEATURES]) / self.temperature
            p_dnf = (self.dnf.predict_proba(g[DNF_FEATURES])[:, 1] if not isinstance(self.dnf, float)
                     else np.full(n, self.dnf))
            out += [{"stage": stage, "driver_id": d, "probs": p}
                    for d, p in zip(g["driver_id"], simulate(strength, p_dnf, rng))]
        return pd.DataFrame(out)


def simulate(strength: np.ndarray, p_dnf: np.ndarray, rng: np.random.Generator,
             simulations: int = SIMULATIONS) -> np.ndarray:
    """n x (n + 1) matrix: row i is driver i's distribution over positions 1..n, then not
    classified. A Plackett-Luce draw is the order of strength + Gumbel noise"""
    n = len(strength)
    out_ = rng.random((simulations, n)) < p_dnf
    key = np.where(out_, -np.inf, strength + rng.gumbel(size=(simulations, n)))
    rank = (-key).argsort(axis=1).argsort(axis=1)  # 0 = winner; retirements rank last among themselves
    category = np.where(out_, n, rank)
    counts = np.zeros((n, n + 1))
    np.add.at(counts, (np.tile(np.arange(n), simulations), category.ravel()), 1)
    return counts / simulations
