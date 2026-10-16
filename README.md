# race-preds

A live F1 race-weekend dashboard: predicted finishing order and qualifying, tyre
strategy, safety car / red flag risk, weather and circuit context, refreshed through each
race weekend (Thu–Sun).

**Live at https://lizhezhao.github.io/race-preds/**

## Status

As of 2026-10-16. The full plan, decisions and phase records are in
[`docs/pipeline-plan.md`](docs/pipeline-plan.md).

- **Done**: the Databricks lakehouse for a session (Phase 1), replaying a past weekend
  end to end (Phase 2), and the front end, live with real 2026 R15–R17 results and
  predictions.
- **Next**: go live with the baseline models. The scheduled dispatcher's first real
  publish is the R18 Austin `pre_weekend` build on 2026-10-22.
- **In progress** (Phase 3, between race weekends): backfill from 2022, the feature
  table, the evaluation harness and trained models registered in MLflow. The backfill
  is complete for 2024–2026; 2022 and 2023 wait on F1's live timing archive, which has
  blocked requests since 2026-10-15.

While a prediction's `model.calibrated` is `false`, the dashboard shows its numbers as
model scores, not chances.

## How it works

1. **Lakehouse** (Databricks Free Edition): a job ingests one session from FastF1,
   Jolpica and Open-Meteo into a Unity Catalog Volume, then Spark builds Delta tables
   bronze → silver → gold. Spark is used on purpose even though the data is small.
2. **Models**: trained in pandas on a snapshot of `gold.features`, registered in MLflow /
   Unity Catalog, and exported as a bundle that publish scores without Spark.
3. **Dashboard**: publish writes static JSON documents that validate against
   [`src/schema.py`](src/schema.py). A static React app in [`web/`](web/) reads them.

A GitHub Actions dispatcher ([`.github/workflows/dispatch.yml`](.github/workflows/dispatch.yml))
runs every 30 minutes Thursday to Monday. It runs any finished session through the
Databricks job, publishes the round, uploads the tree to the `published` GitHub Release
and deploys it to GitHub Pages. There is no application server, and the browser never
talks to Databricks.

## Setup

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

To keep the venv outside the repo, create it elsewhere and link it in: tools only look
for `.venv`.

```bash
uv venv --python 3.12 ~/.venvs/race-preds
ln -s ~/.venvs/race-preds .venv
```

Databricks credentials go in a local `.env`, which is gitignored. The pipeline
(`src/dispatch`, `src/publish`, `src/models/registry.py`) reads it:

```bash
cp .env.example .env    # then fill in DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_HTTP_PATH
```

The Databricks Asset Bundle is in [`databricks/`](databricks/) (see its README). The
front end needs Node:

```bash
cd web && npm ci
npm run dev             # serves the example round at /race-preds/
```

Run Jupyter from the repo root so notebooks in `nb/` can `from src.config import ...`.

## Common commands

```bash
python -m src.schema check docs/examples/v1/2025/16   # validate a round directory
python -m src.dispatch.replay 2026 15                 # replay a weekend into outputs/site/v1
scripts/site_release.sh upload outputs/site/v1        # check and release a published tree
gh workflow run pages.yml                             # deploy it to GitHub Pages
```

After changing `src/schema.py`, regenerate the JSON Schema, the examples and the front-end
types:

```bash
python -m src.schema export docs/schema
python docs/examples/make_examples.py
cd web && npm run gen:types
```

## Data

- **FastF1**: official timing, weather, track status and race control messages. The
  first load of a session is slow; after that it comes from `data/fastf1_cache/`.
  Telemetry is the expensive part, so load with `telemetry=False` unless you need it.
- **Jolpica** (the Ergast mirror, via `fastf1.ergast.Ergast`): results, standings, pit
  stops and circuit locations. Rate limited.
- **Open-Meteo**: the race-week weather forecast, which FastF1 does not have.

## Layout

- `src/` — the pipeline: `ingest/`, `etl/` (Spark), `models/`, `publish/`, `dispatch/`,
  the artifact schema, and the exploration modules they build on
- `databricks/` — Asset Bundle: jobs and notebooks
- `web/` — the dashboard (Vite, React, Tailwind)
- `nb/` — exploratory notebooks
- `docs/` — pipeline plan, artifact schema, exported JSON Schema, example round
- `reference/circuits/` — committed circuit geometry
- `scripts/` — publish-tree checks and release upload
- `data/`, `models/`, `outputs/` — caches and generated files (gitignored)
- `demo/` — borrowed reference notebook (Baku pre-qualifying model); not part of the
  pipeline
