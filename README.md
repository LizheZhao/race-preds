# race-preds

A live F1 race-weekend dashboard: predicted finishing order, tyre strategy, safety car
risk, weather and circuit context, refreshed through each race weekend (Thu–Sun) and
served from a public link.

## Status

Phase 1: data exploration ([`nb/fastf1-data-explore.ipynb`](nb/fastf1-data-explore.ipynb))
and the artifact schema ([`docs/artifact-schema.md`](docs/artifact-schema.md)).

## How it works

A Python pipeline runs through each race weekend and writes static JSON documents
(predictions, weather, strategy, facts, results). A separate static front end reads them.
There is no application server. [`src/schema.py`](src/schema.py) defines every document,
and [`docs/examples/v1/`](docs/examples/v1/) holds a complete synthetic example round.

## Setup

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

Plain `python3 -m venv .venv && pip install -r requirements.txt` works too.

Run Jupyter from the repo root so notebooks in `nb/` can `from src.config import ...`:

```bash
jupyter lab
```

## Data

**FastF1** — official timing, telemetry, weather, track status and race control messages.
No auth. First load of a session hits the network and is slow; everything after that comes
from `data/fastf1_cache/`.

```python
from src.config import SEASON, enable_cache
import fastf1

enable_cache()
session = fastf1.get_session(SEASON, 1, "R")
session.load(telemetry=False)   # telemetry is the expensive part -- opt in
```

**Ergast via jolpica** (`fastf1.ergast.Ergast`, pointing at `api.jolpi.ca`) — championship
standings and pit stop durations, which FastF1's own timing data does not expose. Rate
limited, so cache anything the dashboard depends on.

Everything under `data/`, `models/` and `outputs/` is gitignored — re-downloadable or
regeneratable.

## Planned sections

Race week weather · circuit info · predicted finishing order · optimal tyre strategy ·
safety car / red flag risk · fun facts.

## Layout

- `nb/` — exploratory notebooks
- `src/` — config, artifact schema, and (Phase 2) data loading, features, models
- `docs/` — artifact schema design, exported JSON Schema, example round
- `data/fastf1_cache/` — FastF1 session cache (gitignored)
- `data/raw/`, `data/processed/` — downloaded and derived datasets (gitignored)
- `models/` — trained model artifacts (gitignored)
- `outputs/` — generated per-race JSON payloads for the dashboard (gitignored)
- `demo/` — borrowed reference notebook (pre-qualifying winner model for Baku); reference
  only, not part of the pipeline
