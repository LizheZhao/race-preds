# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

A live F1 race-weekend dashboard, deployed behind a public link and refreshed Thu–Sun
during a race weekend. Planned sections: race week weather, circuit info, predicted
finishing order, optimal tyre strategy, safety car / red flag risk, fun facts.

**The owner is building this repo themselves. Claude acts as a guide:** explain, review,
plan and point at docs, but **don't write or edit code** (Python, notebooks, workflows,
bundle config, front end) unless explicitly asked for that specific piece. Editing docs
such as this file and `docs/*.md` is fine when asked.

**Architecture (decided):** three parts, detailed in `docs/pipeline-plan.md`.

1. **Lakehouse**: ingest FastF1 / Jolpica / Open-Meteo into a Unity Catalog Volume, then
   Spark ETL into Delta bronze → silver → gold on Databricks (Free Edition). Spark is
   used deliberately even though the lap data is small.
2. **Models**: finishing order, qualifying, race incidents (SC/VSC/red flag) and tyre
   strategy are trained and scored on Databricks and tracked in MLflow.
3. **Dashboard**: a publish step turns the predictions into static JSON that validates
   against `src/schema.py`. A static front end only reads that JSON.

The browser never talks to Databricks, and there is no application server. A GitHub
Actions dispatcher runs everything on a schedule: it reads the FastF1 event schedule and
a state table and processes each finished session. **No Streamlit.** The owner uses it
at work and rejected it as too inflexible. The front-end framework and hosting are
still undecided, so don't scaffold a front end until they're chosen.

**Status**: data exploration and the artifact schema are done. Next steps are the
"Next up" list in `docs/pipeline-plan.md`: `src/sessions.py` for the weekend formats,
then Phase 0, a platform spike to establish Free Edition's outbound network, external
job triggers and quotas.

## Setup & commands

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

Dependencies live in a single top-level `requirements.txt` (plain pip/uv, no extras
groups). `uv` is installed on this machine; the system `python3` is 3.9, so always create
the venv with an explicit `--python 3.12`.

Run Jupyter **from the repo root**, not from `nb/` — notebooks resolve `ROOT` by checking
whether `Path.cwd().name == "nb"`, but imports are cleanest from the root:

```bash
jupyter lab
```

Artifact schema:

```bash
python -m src.schema check docs/examples/v1/2025/16   # cross-file validation of a round dir
python -m src.schema export docs/schema               # after any edit to src/schema.py
python docs/examples/make_examples.py                 # after any edit to src/schema.py
```

After changing `src/schema.py`, run the last two and then `check`. Otherwise the JSON
Schema and examples the front end depends on go stale.

No lint/test tooling exists. This is notebook-driven exploratory work, not a packaged
application; don't add a test runner unless asked.

## Architecture

### `src/config.py`
The only place paths and season constants are defined. Every notebook and script starts
with `enable_cache()`, which creates `data/`, `models/`, `outputs/` and points FastF1 at
`data/fastf1_cache/`. Exports `ROOT`, `DATA_DIR`, `CACHE_DIR`, `RAW_DIR`, `PROCESSED_DIR`,
`MODEL_DIR`, `OUTPUT_DIR`, `SEASON` (currently 2025) and `FIRST_TIMING_SEASON` (2018 — the
first season with usable FastF1 timing coverage). Add new shared paths here rather than
hardcoding them in notebooks.

### `docs/pipeline-plan.md`
The build plan: data flow, lakehouse layers, the `ops.processed_sessions` state table,
the dispatcher, the proposed `src/` layout and phases with exit checks. Read it before
proposing any pipeline or infrastructure work, and keep it current when decisions change.

### `src/schema.py` + `docs/artifact-schema.md`
The contract between the pipeline and the front end. Pydantic models for ten document
types (`index`, `manifest`, `event`, `weather`, `finishing_order`, `qualifying`,
`race_incidents`, `strategy`, `facts`, `results`), plus `check_round()` for cross-file
invariants. Read the doc before changing the layout or adding a section. Key rules:
probabilities are fractions in [0, 1]; units are field-name suffixes; ids are Ergast
`driverId`/`constructorId`; prediction sections keep one snapshot per stage at
`<section>/<stage>.json`; every prediction carries `model.calibrated`, and while it is
`false` the front end must call the numbers model scores, not chances.
Computed fields (`p_win`, `p_podium`, `stops`, …) are serialized but stripped and
re-derived on read. Don't add them as stored fields.

### `nb/fastf1-data-explore.ipynb`
The Phase 1 deliverable and the map of the whole project. Sections 1–9 are each tied to a
dashboard panel: schedule → results → weather → circuit → laps/tyres → track status →
telemetry → Ergast → an **availability map** (which panel can refresh on which day) and a
**cost table** (what each FastF1 load costs). Read section 9 before designing the Phase 2
refresh job — it is the contract the pipeline has to honour. Sections 10–14 apply the
modules below: season results, session summaries, long runs / degradation, a
stage-safe weekend feature table and the minute timeline.
`nb/race-weekend-predict.ipynb` uses the same modules for one weekend's predictions.

### Exploration modules in `src/`
Reusable functions written with the owner, one file per future pipeline table (see the
mapping in `docs/pipeline-plan.md`). Functions that take a `session` need it loaded with
laps, weather and messages.

- `sessions.py`: weekend formats. `SESSION_IDS` (FastF1 name → id, Sprint Shootout → SQ),
  `get_sessions`, `get_session_stage` (sessions usable at a stage), `load_weekend`, and
  `session_window` (first Started → last Finished).
- `results.py`: `get_season_results(year, kind)` / `get_results(years, kind)` for race,
  sprint, qualifying (Ergast, via the generic pager `collect_pages`) and sprint
  qualifying (FastF1, which Ergast lacks).
- `summaries.py`: `summarize_session()` returns a per-driver and a per-session table for
  any session type. Its track status counts are the `race_incidents` label definition.
- `timeline.py`: `session_timeline()` returns one row per minute.
- `long_runs.py`: `long_runs()` returns one row per clean stint, with median pace and
  degradation slope.
- `features.py`: `weekend_features()` joins per-session features side by side for a stage.

### `demo/`
A borrowed educational notebook (XGBoost pre-qualifying winner model for Baku, features
built entirely from Ergast race results), plus a Lovable dashboard built from it.
Reference only. Its model and export format are **not** reused, and it should not be
imported from or edited. Useful as a worked example of the
train/test-by-season split and of exporting a model + metadata bundle for a front end.

## FastF1 specifics that matter here

- `Session.load()` loads laps, telemetry, weather and messages by default. **Telemetry is
  the expensive part** (tens of MB per session). Default to `load(telemetry=False)` and
  opt in explicitly. Weather-only scans use
  `load(laps=False, telemetry=False, weather=True, messages=False)`.
- `Ergast` now points at the jolpica mirror (`api.jolpi.ca`); ergast.com is retired. It is
  rate limited and pages default to 30 results — pass `limit=` for anything with more rows
  (a race has ~40 pit stops).
- Track status codes on `Session.track_status` and in the per-lap `TrackStatus` string:
  `1` clear, `2` yellow, `4` safety car, `5` red flag, `6` VSC deployed, `7` VSC ending.
  A lap's `TrackStatus` concatenates every status active during that lap (`"14"` = clear
  then safety car), so match with `.str.contains()`, not equality.
- **Sprint weekends shift the session layout.** Never key off `Session4 == "Qualifying"`;
  use `Event.get_race()` / `get_qualifying()` / `get_sprint()`.
- `ClassifiedPosition` (not `Position`) carries DNF information: `"R"` retired,
  `"D"` disqualified, `"E"` excluded, `"W"` withdrawn, `"N"` not classified.
- FastF1 has **no weather forecast**, only observed weather. The Thursday weather panel
  needs an external API (Open-Meteo, keyed on circuit lat/lon from Ergast `get_circuits`).
- Pirelli tyre allocation per round is not in FastF1 at all.

## 2026 season

- **22 cars, 11 teams** (Audi replaces Sauber, Cadillac is new). Never hardcode 20
  entrants: distribution lengths, grid sizes and Q1/Q2 cut-offs all derive from the entry list.
- **DRS is gone** (replaced by active aero). The 2025 exploration notebook computes DRS
  usage from telemetry, which is meaningless for 2026. Verify what FastF1's `DRS`
  channel carries before using it.
- New technical regulations make pre-2026 form a weak prior. Weight recent races heavily.
- `src/config.SEASON` is 2025, the exploration reference season. The live pipeline
  targets the current season and should take it from the schedule, not from that constant.

## Conventions

- Notebooks in `nb/`, reusable code in `src/`, following the same layout as the
  `playground` repo's competition folders.
- Databricks host and token live in a local `.env` and in GitHub Actions secrets, never
  in code, notebooks, the front end or published JSON.
- `data/`, `models/` and `outputs/` are gitignored in full — re-download or regenerate
  rather than committing. Same for `demo/baku_cache/` and `demo/baku_outputs/`.
- Notebook style: short `#` comments above logical blocks, f-strings for output,
  double-quoted strings, one concise markdown header per section.
