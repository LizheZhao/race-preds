"""
model registry and the champion bundle (docs/pipeline-plan.md, Phase 3 plan step 5)

    python -m src.models.registry train finishing_order            # fit, backtest, log, register
    python -m src.models.registry export finishing_order --version 3
    python -m src.models.registry export finishing_order --alias champion --upload
    python -m src.models.registry download                         # released bundles -> MODEL_DIR

a bundle is a directory, MODEL_DIR/<section>/: model.joblib (the fitted candidate) and
meta.json (name, version, trained_through, features, backtest). Training logs it to MLflow
as a pyfunc model (src/models/pyfunc.py) and registers it in Unity Catalog as
race_preds.models.<section>. Export writes one registered version's bundle; upload puts
every exported bundle in the "models" GitHub Release, which the dispatcher downloads.
Publish only ever reads a bundle, so scoring needs neither Spark nor MLflow
(Decisions, 2026-10-13)
"""
import argparse
import json
import shutil
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import joblib
import pandas as pd

from src.config import FEATURES_SNAPSHOT, MODEL_DIR, ROOT, enable_cache

UC_NAME = "race_preds.models.{section}"
RELEASE_TAG, RELEASE_ASSET = "models", "models-v1.tar.gz"
REPO = "LizheZhao/race-preds"


@dataclass
class Bundle:
    model: object
    meta: dict


def read_bundle(path: Path) -> Bundle:
    return Bundle(joblib.load(path / "model.joblib"), json.loads((path / "meta.json").read_text()))


def load(section: str, root: Path = MODEL_DIR) -> Bundle | None:
    """the exported bundle of a section, or None when there is none (publish then uses the baseline)"""
    path = root / section
    return read_bundle(path) if (path / "meta.json").exists() else None


def released(root: Path = MODEL_DIR) -> list[str]:
    """sections with a bundle under root"""
    return sorted(p.parent.name for p in root.glob("*/meta.json"))


SECTIONS = ("finishing_order", "qualifying")


def _sections():
    from src.models.candidates import GridOrder, QualiSeasonAverage
    from src.models.finishing import QualiStrengthPL, StrengthPLStage
    # section: (model, the baseline it must beat)
    return {"finishing_order": (StrengthPLStage, GridOrder), "qualifying": (QualiStrengthPL, QualiSeasonAverage)}


def backtest(section: str, features: pd.DataFrame) -> list[dict]:
    """schema Metric entries: the model's RPS against its baseline, per split, before and after Q"""
    from src.models import evaluate

    model_cls, baseline_cls = _sections()[section]
    s = evaluate.summarize(evaluate.run(features, [model_cls(), baseline_cls()]))
    s["phase"] = s["stage"].map(lambda st: "after Q" if st == "Q" else "before Q")
    out = []
    for (split, phase), g in s.groupby(["split", "phase"]):
        rps = g.groupby("model")["rps"].mean()
        out.append({"name": "rps", "value": round(float(rps[model_cls.name]), 4), "lower_is_better": True,
                    "baseline_name": baseline_cls.name, "baseline_value": round(float(rps[baseline_cls.name]), 4),
                    "evaluated_on": f"{split.replace('_', ' ')}, {int(g['rounds'].max())} rounds, predictions {phase}"})
    return out


def _trained_through(features: pd.DataFrame) -> str:
    from src.publish import reference as ref
    done = features.loc[features["y_classified"].notna(), ["season", "round"]]
    last = done.sort_values(["season", "round"]).iloc[-1]  # the latest race, not each column's max
    return str(ref.event(int(last["season"]), int(last["round"]))["EventDate"].date())


def _mlflow():
    import mlflow
    from dotenv import load_dotenv
    from src.dispatch.jobs import _client

    load_dotenv(ROOT / ".env")
    mlflow.set_tracking_uri("databricks")
    mlflow.set_registry_uri("databricks-uc")
    mlflow.set_experiment(f"/Users/{_client().current_user.me().user_name}/race_preds/models")
    return mlflow


def train(section: str, before: tuple[int, int] | None = None) -> str:
    """fit on every labelled row of the snapshot (or only rounds before `before`, to replay a
    past round without its own result), log and register; returns the registered version"""
    from mlflow.models import infer_signature
    from src.models.pyfunc import PyfuncBundle, flat

    features = pd.read_parquet(FEATURES_SNAPSHOT)
    if before:
        features = features[features["season"] * 100 + features["round"] < before[0] * 100 + before[1]]
    model = _sections()[section][0]()
    model.fit(features)
    meta = {"section": section, "name": model.name, "trained_through": _trained_through(features),
            "features": model.features, "calibrated": False, "backtest": backtest(section, features)}

    mlflow = _mlflow()
    sample = features[features["stage"] == "pre_weekend"].head(22)
    with tempfile.TemporaryDirectory() as tmp, mlflow.start_run(run_name=f"{model.name} {section}"):
        bundle = Path(tmp) / "bundle"
        bundle.mkdir()
        joblib.dump(model, bundle / "model.joblib")
        (bundle / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
        mlflow.log_params({"section": section, "model": model.name, "trained_through": meta["trained_through"],
                           "rows": len(features)})
        mlflow.log_metrics({f"rps {m['evaluated_on'].replace(',', '')}": m["value"] for m in meta["backtest"]})
        info = mlflow.pyfunc.log_model(name="model", python_model=PyfuncBundle(), artifacts={"bundle": str(bundle)},
                                       signature=infer_signature(sample, flat(model.predict(sample, sample.iloc[:0]))))
    version = mlflow.register_model(info.model_uri, UC_NAME.format(section=section)).version
    print(f"{UC_NAME.format(section=section)} version {version}")
    for m in meta["backtest"]:
        print(f"  {m['evaluated_on']}: rps {m['value']} vs {m['baseline_name']} {m['baseline_value']}")
    return str(version)


def export(section: str, version: str | None = None, alias: str | None = None, root: Path = MODEL_DIR) -> dict:
    """write one registered version's bundle to root/<section>, with its version in meta.json"""
    from mlflow import MlflowClient

    mlflow = _mlflow()
    name = UC_NAME.format(section=section)
    client = MlflowClient()
    mv = client.get_model_version_by_alias(name, alias) if alias else client.get_model_version(name, version)
    target = root / section
    with tempfile.TemporaryDirectory() as tmp:
        local = Path(mlflow.artifacts.download_artifacts(f"models:/{name}/{mv.version}", dst_path=tmp))
        shutil.rmtree(target, ignore_errors=True)
        shutil.copytree(local / "artifacts" / "bundle", target)
    meta = json.loads((target / "meta.json").read_text()) | {"version": f"v{mv.version}"}
    (target / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"{name} v{mv.version} -> {target}")
    return meta


def upload(root: Path = MODEL_DIR) -> None:
    """every exported bundle under root, as the one asset of the "models" release"""
    sections = sorted(p.parent.name for p in root.glob("*/meta.json"))
    with tempfile.TemporaryDirectory() as tmp:
        asset = Path(tmp) / RELEASE_ASSET
        with tarfile.open(asset, "w:gz") as tar:
            for section in sections:
                tar.add(root / section, arcname=section)
        if subprocess.run(["gh", "release", "view", RELEASE_TAG, "--repo", REPO], capture_output=True).returncode:
            subprocess.run(["gh", "release", "create", RELEASE_TAG, "--repo", REPO, "--title", "Champion models",
                            "--latest=false", "--notes", "Champion model bundles (src/models/registry.py)."], check=True)
        subprocess.run(["gh", "release", "upload", RELEASE_TAG, str(asset), "--repo", REPO, "--clobber"], check=True)
    print(f"uploaded {sections} -> {REPO}@{RELEASE_TAG}")


def download(root: Path = MODEL_DIR) -> bool:
    """the released bundles into root; False when there is no release yet (publish uses the baselines)"""
    url = f"https://github.com/{REPO}/releases/download/{RELEASE_TAG}/{RELEASE_ASSET}"
    try:
        with urllib.request.urlopen(url) as resp, tempfile.TemporaryFile() as f:
            shutil.copyfileobj(resp, f)
            f.seek(0)
            root.mkdir(parents=True, exist_ok=True)
            with tarfile.open(fileobj=f) as tar:
                tar.extractall(root, filter="data")
    except urllib.error.HTTPError as exc:
        print(f"no released models ({exc.code}), publish uses the baselines")
        return False
    print(f"downloaded {sorted(p.parent.name for p in root.glob('*/meta.json'))} -> {root}")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["train", "export", "download"])
    parser.add_argument("section", nargs="?", choices=SECTIONS)
    parser.add_argument("--version")
    parser.add_argument("--alias")
    parser.add_argument("--before", nargs=2, type=int, metavar=("SEASON", "ROUND"), help="train only on earlier rounds")
    parser.add_argument("--upload", action="store_true", help="after export, release every exported bundle")
    args = parser.parse_args()

    enable_cache(verbose=False)
    if args.command == "train":
        train(args.section, tuple(args.before) if args.before else None)
    elif args.command == "export":
        export(args.section, args.version, args.alias)
        if args.upload:
            upload()
    else:
        download()
