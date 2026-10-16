"""
the evaluation harness (docs/pipeline-plan.md, Phase 3 plan step 3): splits, metrics and
the runner every candidate goes through. Frozen once written: models change, this doesn't.
Pure pandas, reading a Parquet snapshot of race_preds.gold.features

    python -m src.models.evaluate snapshot            # gold.features -> FEATURES_SNAPSHOT
    python -m src.models.evaluate run                 # every candidate on every split
    python -m src.models.evaluate run --log           # ... and log to MLflow
    python -m src.models.evaluate run --holdout       # the 2025 holdout, once per model

a fold trains on rows before a cut-off and tests one round. A candidate predicts a position
distribution per driver and stage; for finishing order the last category is "not
classified". Models are compared on ranked probability score and log loss; the readable
hit rates are reported, never used to choose
"""
import argparse
from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.config import FEATURES_SNAPSHOT

SEASON_SPLIT = (2023, 2024)  # trained on the era's earlier seasons, 2022 on
WALK_FORWARD = (2026, 6)  # season, first test round; later rounds join as they are played
HOLDOUT = 2025
LOG_FLOOR = 1e-6
METRICS = ["rps", "log_loss", "first_hit", "top3_hits", "top10_hits", "rank_error"]


@dataclass(frozen=True)
class Fold:
    split: str
    train_before: int  # rank key season * 100 + round; training rows are strictly before it
    season: int
    round: int


def rank_key(season, rnd):
    return season * 100 + rnd


def folds(features: pd.DataFrame, holdout: bool = False) -> list[Fold]:
    played = features.loc[features["y_classified"].notna(), ["season", "round"]].drop_duplicates()
    rounds = lambda season, first=1: sorted(played.loc[(played["season"] == season) & (played["round"] >= first), "round"])
    if holdout:
        return [Fold(f"holdout_{HOLDOUT}", rank_key(HOLDOUT, 0), HOLDOUT, r) for r in rounds(HOLDOUT)]
    out = [Fold(f"season_{s}", rank_key(s, 0), s, r) for s in SEASON_SPLIT for r in rounds(s)]
    season, first = WALK_FORWARD
    out += [Fold(f"walk_forward_{season}", rank_key(season, r), season, r) for r in rounds(season, first)]
    return out


# ---------------------------------------------------------------- outcomes and metrics


def section_rows(section: str, rows: pd.DataFrame) -> pd.DataFrame:
    """qualifying is predicted only at stages before Q has run (a stage, not per driver: a
    driver without a qualifying time has no position after Q either)"""
    if section != "qualifying":
        return rows
    q_ran = rows.groupby("stage")["quali_position"].transform(lambda s: s.notna().any())
    return rows[~q_ran]


def outcome(section: str, rows: pd.DataFrame, n: int) -> pd.Series:
    """index of the category each driver ended in (finishing: n = not classified); NaN = no label"""
    if section == "qualifying":
        return rows["y_quali"] - 1
    classified = rows["y_classified"].astype("boolean")
    return (rows["y_finish"] - 1).where(classified, n).where(classified.notna())


def rps(probs: np.ndarray, k: int) -> float:
    """ranked probability score of one distribution over ordered categories, 0 is perfect"""
    cum = np.cumsum(probs)[:-1]
    hit = (np.arange(len(probs) - 1) >= k).astype(float)
    return float(np.mean((cum - hit) ** 2))


def score_round(section: str, pred: pd.DataFrame, rows: pd.DataFrame) -> pd.DataFrame:
    """one fold's predictions (keys + probs) against the labels: one row per stage"""
    n = rows["driver_id"].nunique()
    df = pred.merge(rows[["stage", "driver_id", "y_finish", "y_classified", "y_quali"]], on=["stage", "driver_id"])
    df["k"] = outcome(section, df, n)
    out = []
    for stage, g in df.groupby("stage"):
        g = g.dropna(subset=["k"])
        probs = np.stack(g["probs"].to_numpy())
        k = g["k"].astype(int).to_numpy()
        p_true = probs[np.arange(len(k)), k]
        positions = probs[:, :n] / probs[:, :n].sum(axis=1, keepdims=True)
        expected = positions @ np.arange(1, n + 1)
        pred_rank = expected.argsort().argsort() + 1
        finished = k < n if section == "finishing_order" else np.ones(len(k), bool)
        actual = k + 1
        top = lambda m: len(set(np.where(pred_rank <= m)[0]) & set(np.where(finished & (actual <= m))[0]))
        out.append({
            "stage": stage,
            "rps": float(np.mean([rps(p, kk) for p, kk in zip(probs, k)])),
            "log_loss": float(-np.mean(np.log(np.maximum(p_true, LOG_FLOOR)))),
            "first_hit": float(top(1)),
            "top3_hits": float(top(3)),
            "top10_hits": float(top(10)),
            "rank_error": float(np.mean(np.abs(pred_rank[finished] - actual[finished]))),
        })
    return pd.DataFrame(out)


# ---------------------------------------------------------------- runner


def run(features: pd.DataFrame, candidates: list, holdout: bool = False) -> pd.DataFrame:
    """every candidate on every fold; returns one row per candidate x fold x stage"""
    features = features.assign(rk=rank_key(features["season"], features["round"]))
    labels = features.drop_duplicates(["season", "round", "driver_id"])  # labels repeat per stage
    fitted = set()
    results = []
    for fold in folds(features, holdout):
        test = features[(features["season"] == fold.season) & (features["round"] == fold.round)]
        history = labels[labels["rk"] < rank_key(fold.season, fold.round)]
        for cand in candidates:
            key = (cand.name, fold.train_before)
            if key not in fitted:
                cand.fit(features[features["rk"] < fold.train_before])
                fitted.add(key)
            rows = section_rows(cand.section, test)
            if rows.empty:
                continue
            scored = score_round(cand.section, cand.predict(rows, history), rows)
            results.append(scored.assign(model=cand.name, section=cand.section, split=fold.split,
                                         season=fold.season, round=fold.round))
    return pd.concat(results, ignore_index=True)


def summarize(scores: pd.DataFrame) -> pd.DataFrame:
    """mean over a split's rounds, per section x split x stage x model"""
    return (scores.groupby(["section", "split", "stage", "model"])[METRICS].mean()
            .join(scores.groupby(["section", "split", "stage", "model"]).size().rename("rounds")).reset_index())


def log_to_mlflow(summary: pd.DataFrame) -> None:
    """one MLflow run per model x section x split, metrics named <stage>.<metric>"""
    import mlflow
    from dotenv import load_dotenv
    from src.config import ROOT
    from src.dispatch.jobs import _client

    load_dotenv(ROOT / ".env")
    me = _client().current_user.me().user_name
    _client().workspace.mkdirs(f"/Users/{me}/race_preds")
    mlflow.set_tracking_uri("databricks")
    mlflow.set_experiment(f"/Users/{me}/race_preds/backtest")
    for (model, section, split), g in summary.groupby(["model", "section", "split"]):
        with mlflow.start_run(run_name=f"{model} {section} {split}"):
            mlflow.set_tags({"model": model, "section": section, "split": split})
            mlflow.log_param("rounds", int(g["rounds"].max()))
            for r in g.itertuples():
                mlflow.log_metrics({f"{r.stage}.{m}": getattr(r, m) for m in METRICS})


def snapshot() -> pd.DataFrame:
    from src.publish.lakehouse import query
    df = query("SELECT * FROM race_preds.gold.features")
    FEATURES_SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(FEATURES_SNAPSHOT, index=False)
    return df


if __name__ == "__main__":
    from src.models.candidates import CANDIDATES

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["snapshot", "run"])
    parser.add_argument("--log", action="store_true", help="log the summary to MLflow")
    parser.add_argument("--holdout", action="store_true", help=f"score the {HOLDOUT} holdout instead of the backtest")
    args = parser.parse_args()

    if args.command == "snapshot":
        df = snapshot()
        print(f"{FEATURES_SNAPSHOT}: {len(df)} rows, seasons {sorted(df['season'].unique())}")
    else:
        summary = summarize(run(pd.read_parquet(FEATURES_SNAPSHOT), [c() for c in CANDIDATES], args.holdout))
        with pd.option_context("display.width", 200, "display.max_rows", 500, "display.float_format", "{:.3f}".format):
            print(summary.to_string(index=False))
        if args.log:
            log_to_mlflow(summary)
