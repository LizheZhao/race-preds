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

strength-pl fits one strength model and temperature for every stage; strength-pl-stage
fits one per stage, so the grid's weight and the spread after Q are not averaged with the
stages where the grid is unknown. strength-pl-quali is strength-pl-stage on qualifying
position, at the stages before Q, with no retirements

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
MIN_STAGE_ROUNDS = FOLDS  # fewer training rounds at a stage: the stage before it is used (STAGE_FALLBACK)
STAGE_FALLBACK = {"FP1": "pre_weekend", "FP2": "FP1", "FP3": "FP2", "SQ": "FP1", "S": "SQ", "Q": "FP3"}
OLD_SPRINT_FORMATS = ("sprint", "sprint_shootout")


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


def _fit_strength(rows: pd.DataFrame, target: str = "y_finish"):
    """ridge on a position (the classified drivers' finishing positions, or qualifying), and
    the Plackett-Luce temperature from out-of-fold strengths, grouped by round so a round
    never predicts itself"""
    strength = _strength_model().fit(rows[STRENGTH_FEATURES], rows[target])
    rounds = rows["season"] * 100 + rows["round"]
    k = min(FOLDS, rounds.nunique())
    oof = (cross_val_predict(_strength_model(), rows[STRENGTH_FEATURES], rows[target],
                             groups=rounds, cv=GroupKFold(k)) if k >= 2 else
           strength.predict(rows[STRENGTH_FEATURES]))
    scored = rows.assign(s=-oof)
    groups = [g.sort_values(target)["s"].to_numpy() for _, g in scored.groupby(["season", "round", "stage"])]
    return strength, minimize_scalar(lambda t: -_pl_loglik(t, groups), bounds=(0.05, 20), method="bounded").x


def _fit_stages(rows: pd.DataFrame, target: str = "y_finish") -> dict:
    """_fit_strength per stage_key, for the stages with at least MIN_STAGE_ROUNDS rounds"""
    return {stage: _fit_strength(g, target) for stage, g in rows.groupby(stage_key(rows))
            if g[["season", "round"]].drop_duplicates().shape[0] >= MIN_STAGE_ROUNDS}


def stage_key(rows: pd.DataFrame) -> pd.Series:
    """the stage model a row belongs to: its stage, or None on the 2021-23 sprint formats. Those
    ran Q before the sprint, so FP2, SQ and S there hold what Q holds today; the pooled model
    trains on and scores them. Rows without event_format count as today's formats"""
    if "event_format" not in rows:
        return rows["stage"]
    return rows["stage"].where(~rows["event_format"].isin(OLD_SPRINT_FORMATS), None)


def _unseen_missing(model, x: pd.DataFrame) -> np.ndarray:
    """rows missing a feature the model never saw missing in training: its imputer has no
    indicator for it, so the gap would be filled with the median (a Q-stage entrant without
    a grid would start mid-field)"""
    missing = x.isna().to_numpy()
    missing[:, model.steps[0][1].indicator_.features_] = False
    return missing.any(axis=1)


class StrengthPL:
    name, section = "strength-pl", "finishing_order"
    features = STRENGTH_FEATURES + DNF_FEATURES

    def fit(self, train: pd.DataFrame) -> None:
        done = train[train["y_classified"].notna()]
        self.strength, self.temperature = _fit_strength(done[done["y_classified"] == True])
        y = (done["y_classified"] == False).astype(int)
        self.dnf = (make_pipeline(SimpleImputer(strategy="median", keep_empty_features=True), LogisticRegression(C=1.0))
                    .fit(done[DNF_FEATURES], y) if y.nunique() == 2 else float(y.mean()))

    def _strength(self, g: pd.DataFrame) -> np.ndarray:
        return -self.strength.predict(g[STRENGTH_FEATURES]) / self.temperature

    def _p_dnf(self, g: pd.DataFrame) -> np.ndarray:
        return (self.dnf.predict_proba(g[DNF_FEATURES])[:, 1] if not isinstance(self.dnf, float)
                else np.full(len(g), self.dnf))

    def predict(self, rows: pd.DataFrame, history: pd.DataFrame) -> pd.DataFrame:
        rng = np.random.default_rng(SEED)
        out = []
        for stage, g in rows.groupby("stage"):
            g = g.sort_values("driver_id")
            out += [{"stage": stage, "driver_id": d, "probs": p}
                    for d, p in zip(g["driver_id"], simulate(self._strength(g), self._p_dnf(g), rng))]
        return pd.DataFrame(out)


class StrengthPLStage(StrengthPL):
    """strength-pl with a strength model and temperature per stage (stage_key); a stage with
    fewer than MIN_STAGE_ROUNDS training rounds uses the stage before it, then the pooled model.
    A row missing a feature its stage model never saw missing is scored by the pooled model"""
    name = "strength-pl-stage"

    def fit(self, train: pd.DataFrame) -> None:
        super().fit(train)
        self.stages = _fit_stages(train[train["y_classified"] == True])

    def _strength(self, g: pd.DataFrame) -> np.ndarray:
        stage = stage_key(g).iat[0]
        while stage not in self.stages and stage in STAGE_FALLBACK:
            stage = STAGE_FALLBACK[stage]
        if stage not in self.stages:
            return super()._strength(g)
        model, temperature = self.stages[stage]
        x = g[STRENGTH_FEATURES]
        strength = -model.predict(x) / temperature
        unseen = _unseen_missing(model, x)
        if unseen.any():
            strength[unseen] = super()._strength(g[unseen])
        return strength


class QualiStrengthPL(StrengthPLStage):
    """qualifying order, scored at the stages before Q: per-stage strength on qualifying
    position, and a Plackett-Luce order of every entrant (no one retires)"""
    name, section = "strength-pl-quali", "qualifying"
    features = [f for f in STRENGTH_FEATURES if f not in ("q_best_lap_gap_pct", "quali_position", "grid_position")]

    def fit(self, train: pd.DataFrame) -> None:
        q_ran = train.groupby(["season", "round", "stage"])["quali_position"].transform(lambda q: q.notna().any())
        rows = train[~q_ran & train["y_quali"].notna()]
        self.strength, self.temperature = _fit_strength(rows, "y_quali")
        self.stages = _fit_stages(rows, "y_quali")

    def _p_dnf(self, g: pd.DataFrame) -> np.ndarray:
        return np.zeros(len(g))

    def predict(self, rows: pd.DataFrame, history: pd.DataFrame) -> pd.DataFrame:
        out = super().predict(rows, history)
        out["probs"] = out["probs"].apply(lambda p: p[:-1])  # drop the empty "not classified" category
        return out


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
