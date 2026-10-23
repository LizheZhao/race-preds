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
   strategy are trained in pandas on a snapshot of `gold.features` (by hand for now; a
   Monday Databricks job is planned) and registered in MLflow / Unity Catalog on
   Databricks. Publish scores the exported model on the GitHub runner, without Spark.
3. **Dashboard**: a publish step turns the predictions into static JSON that validates
   against `src/schema.py`. A static front end only reads that JSON.

Databricks is kept on purpose (the Spark / Delta / MLflow showcase), but the race-weekend
path must not depend on it alone: if a Databricks job can't run, the dispatcher scores the
session on the GitHub runner with the same platform-agnostic `src/` code (see "Fallback when
Databricks is unavailable" in `docs/pipeline-plan.md`). Keep scoring and publish code
runnable without Spark.

The browser never talks to Databricks, and there is no application server. A GitHub
Actions dispatcher runs everything on a schedule: it reads the FastF1 event schedule and
a state table and processes each finished session. **No Streamlit.** The owner uses it
at work and rejected it as too inflexible. Front end (decided): a React app designed
once in Lovable, copied into `web/` and maintained here, deployed to GitHub Pages
together with the published JSON (see Part 3 of `docs/pipeline-plan.md`).

**Status**: data exploration, the artifact schema, `src/sessions.py` and Phase 0 (the
Free Edition platform spike) are done. Phase 0 showed serverless can reach FastF1 /
Jolpica / Open-Meteo, so **ingest runs inside a Databricks job**, not on the GitHub
runner; the runner only triggers jobs and publishes. Results and remaining constraints
are in `docs/pipeline-plan.md` (Phase 0 results, Known constraints). Phase 1, the
lakehouse for one race, passed its exit check on 2026 R16: the `process_session` job runs
ingest → bronze → silver → gold for one session and records each task in
`ops.processed_sessions`. Phase 2, the replay, passed on 2026 R15: the dispatcher runs
missing sessions through that job, scores baselines and publishes a validated `v1` tree
to `outputs/site/v1`. **Next is going live with the baselines before 2026-10-22**
(the scheduled dispatcher workflow), then Phase 2b and Phase 3; see "Status and next
steps" at the top of the plan.

`databricks/` holds the Asset Bundle (`databricks.yml`, `resources/*.yml`, notebooks in
Databricks source format). Local Databricks access reads `DATABRICKS_HOST`,
`DATABRICKS_TOKEN` and `DATABRICKS_HTTP_PATH` from `.env` via `python-dotenv`; the CLI
uses the `race-preds` profile.

## Setup & commands

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

Dependencies live in a single top-level `requirements.txt` (plain pip/uv, no extras
groups). `uv` is installed on this machine; the system `python3` is 3.9, so always create
the venv with an explicit `--python 3.12`.

On this machine the venv lives outside the repo at `~/.venvs/race-preds`, and `.venv` in
each checkout is a symlink to it. Don't create a fresh `.venv` in a worktree. Credentials
go in `.env` at the repo root (`cp .env.example .env`), kept only in the main checkout.

Worktrees: the main session normally works in the main checkout without one. Subagent
worktrees branch from the local `HEAD` (`worktree.baseRef` in `.claude/settings.json`),
and `.worktreeinclude` copies `.env` into them. A local SessionStart hook (in
`.claude/settings.local.json`, not committed) links `.env` and `.venv` into any checkout
that lacks them and puts the venv on `PATH`. Work done in a worktree lands on its own
branch; merge it back into the branch the main checkout is on.

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

Replay a past weekend through the whole pipeline (needs `.env` and the deployed bundle):

```bash
python -m src.dispatch.replay 2026 15                 # into outputs/site/v1, round cleared first
python -m src.schema check outputs/site/v1/2026/15
scripts/site_release.sh upload outputs/site/v1        # check + release the tree (needs gh, authenticated)
gh workflow run pages.yml                             # deploy it to GitHub Pages
```

The published tree is the asset of the GitHub Release `published`, not a Volume folder;
`scripts/site_release.sh download <dir>` fetches it, and the Pages workflow deploys it
(the example round only while no release exists).

After changing `src/schema.py`, run the last two and then `check`, then regenerate the
front-end types (`cd web && npm run gen:types`). Otherwise the JSON Schema, examples and
TypeScript types the front end depends on go stale.

Front end (`web/`, Node + npm):

```bash
cd web && npm ci
npm run dev          # copies docs/examples/v1 into public/data, serves at /race-preds/
npm test             # vitest: data loading against docs/examples/v1
npm run build        # tsc + static build into dist/ for GitHub Pages
```

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
The living build plan. It opens with the current status and next steps and a dated list
of decisions, then the design of each part (lakehouse, models, dashboard, automation),
the layout and the phases with exit checks, and ends with the records of finished
phases. Read it before proposing any pipeline or infrastructure work. Keep the status and
the decisions list current when something lands.

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
mapping in `docs/pipeline-plan.md`). The session-level functions take a `SessionTables`
or a FastF1 `Session` loaded with laps, weather and messages; a `Session` is converted
with `as_tables()`. Inside them every duration is float seconds, never a `Timedelta`.

- `sessions.py`: weekend formats. `SESSION_IDS` (FastF1 name → id, Sprint Shootout → SQ),
  `get_sessions`, `get_session_stage` (sessions usable at a stage), `load_weekend`, and
  `session_window` (first Started → last Finished). Also `SessionTables`, one session as
  six plain DataFrames with Timedeltas in seconds: the unit ingest writes and Spark hands
  to `applyInPandas`.
- `laps.py`: `not_deleted`, `clean_laps`, `quick_laps`, plain replacements for FastF1's
  `Laps.pick_*` filters (the future silver lap flags).
- `ingest/fastf1_session.py` (pipeline, not exploration): `ingest_session()` writes one
  session's `SessionTables` as Parquet + `meta.json` under a root (`data/raw` locally,
  `/Volumes/race_preds/raw/fastf1` in the `process_session` bundle job);
  `read_session()` reads it back without FastF1. No Databricks imports. In a job, keep
  the FastF1 cache on local temp disk: SQLite does not work on a Volume. Columns that
  can be all-empty need a type in `FIXED_TYPES`, or ingest refuses to write them.
  FastF1 swallows HTTP errors, so ingest watches its requests: a refused or failed
  archive request raises `ArchiveRequestFailed` (recorded `failed`), and only a missing
  file raises `SessionNotAvailable` (`not_available`). When the archive refuses (401 / 403)
  or the schedule won't load, practice and qualifying come from OpenF1 instead.
- `ingest/openf1_session.py` (pipeline): `load_session()` builds the same `SessionTables`
  from `api.openf1.org`, deriving track status, session status and deleted laps from race
  control. Any column change must keep FastF1's names and types, or bronze's schema merge
  fails. No race or sprint.
- `etl/bronze.py` (pipeline, Spark only, no FastF1): `load_session(spark, session_dir)`
  replaces one session in the `race_preds.bronze.*` Delta tables. Runs as the second
  task of `process_session`; needs a Databricks Spark session, so it cannot run locally.
- `etl/silver.py` (pipeline, Spark-native): `load_session(spark, season, round, session_id)`
  rebuilds `race_preds.silver.laps` / `results` for one session from bronze. Its
  `is_clean` / `is_quick` flags must keep selecting the same laps as `src/laps.py`;
  change both together. Ergast ids are null while a weekend is in progress (see the plan).
- `etl/gold.py` (pipeline): `load_session(spark, season, round, session_id)` runs
  `summarize_session` (on the driver) and `long_runs` (`applyInPandas`) on one session's
  bronze tables into `race_preds.gold.*`. Needs FastF1 installed (imports `src.sessions`).
- `etl/ops.py`: `track(spark, …, stage)` wraps a job task and upserts its status into
  `race_preds.ops.processed_sessions`.
- `dispatch/` (pipeline): `dispatcher.dispatch(season, round, now, site, run_id)` brings
  the lakehouse up to the stage the clock has reached (Databricks SDK, `jobs.py`) and
  publishes it; `replay.py` runs it over a fake clock.
- `publish/` (pipeline): `site.publish(Context, site)` builds every section
  (`documents.py`), falls back to `stale` / `error` per section, and replaces the round
  only after `schema.check_round` passes. Reads go through `lakehouse.py` (SQL warehouse)
  and `reference.py` (FastF1, Ergast, Open-Meteo, cached circuit geometry).
- `models/baselines.py`: the four baseline predictions, pure functions. Scored inside
  publish until the MLflow models replace them.
- `etl/features.py` (pipeline, Spark): `gold.features`, one row per season × round × stage
  × driver, and `leakage_check()`, run by the `build_features` job. Inputs split into
  known-in-advance (schedule, entries, grid) and observed; never let a feature read
  observed data from after its stage.
- `models/evaluate.py`: the frozen evaluation harness (splits, RPS / log loss, runner,
  MLflow logging) over a Parquet snapshot of `gold.features`. `models/candidates.py`
  holds every candidate behind its `fit` / `predict` interface, baselines included.
- `dispatch/backfill.py`: runs the `backfill_round` job round by round; Tuesday and
  Wednesday only.
- `models/finishing.py`: the `strength-pl` finishing-order model (ridge strength, logistic
  DNF, Plackett–Luce Monte Carlo). `models/registry.py`: train → MLflow / Unity Catalog
  (`race_preds.models.<section>`) → export a bundle (`model.joblib` + `meta.json`) →
  the `models` release, which publish loads. Publish never imports MLflow
  (`models/pyfunc.py` holds the MLflow wrapper) and only uses a bundle trained before
  the round it publishes.
- `results.py`: `get_season_results(year, kind)` / `get_results(years, kind)` for race,
  sprint, qualifying (Ergast, via the generic pager `collect_pages`) and sprint
  qualifying (FastF1, which Ergast lacks).
- `summaries.py`: `summarize_session()` returns a per-driver and a per-session table for
  any session type. Its track status counts are the `race_incidents` label definition.
  Gold stores its output in Delta, so each column must keep one type in every session:
  counts are filled with 0, never NaN.
- `timeline.py`: `session_timeline()` returns one row per minute.
- `long_runs.py`: `long_runs()` returns one row per clean stint, with median pace and
  degradation slope; `stint_runs(laps)` is the same on a laps table alone, which gold
  runs through `applyInPandas`.
- `features.py`: `weekend_features()` joins per-session features side by side for a stage.

### `web/`
The dashboard: a static React SPA (Vite, Tailwind, shadcn/ui, Recharts, TanStack Query),
designed once in Lovable and maintained here with no Lovable sync. `web/AGENTS.md` has the
conventions. All fetching is in `web/src/data/api.ts` (base path `/race-preds/`,
cache-busting queries for GitHub Pages' fixed 10-minute cache). Document types are
generated from `docs/schema` into `web/src/data/generated/`; never hand-write them.
`web/public/data` is gitignored and filled by `npm run data [folder]`.

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
  rather than committing. The exception is `reference/circuits/`, committed circuit
  geometry: GitHub runners get 403 from F1 live timing, so publish there can't build it. Same for `demo/baku_cache/` and `demo/baku_outputs/`.
- Notebook style: short `#` comments above logical blocks, f-strings for output,
  double-quoted strings, one concise markdown header per section.
