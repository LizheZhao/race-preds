# Pipeline plan

How data gets from FastF1 to the public dashboard, and how the whole chain refreshes
itself during a race weekend without anyone touching it. This is a plan, not a
description of existing code. Update it as decisions land.

The repo has three parts:

1. **Lakehouse**: ingest FastF1 / Jolpica / Open-Meteo, then Spark ETL into Delta tables
   on Databricks (bronze → silver → gold).
2. **Models**: finishing order, qualifying, race incidents (SC/VSC/red flag), tyre
   strategy. They are trained and scored on Databricks and tracked in MLflow.
3. **Dashboard**: a static front end that reads JSON documents conforming to
   `src/schema.py` (see `docs/artifact-schema.md`).

## Architecture

```
FastF1 / Jolpica / Open-Meteo
        │  ① ingest                      (Databricks job)
        ▼
UC Volume: raw Parquet
        │  ② Spark ETL                   (Databricks job)
        ▼
bronze → silver → gold  (Delta)
        │  ③ features + train / score    (Databricks job, MLflow)
        ▼
predictions tables (Delta)
        │  ④ publish                     (GitHub Actions runner)
        ▼
JSON documents, validated by src/schema.py
        │  ⑤ deploy
        ▼
static host  ←  browser fetches JSON; all interaction is client-side
```

### Ground rules

- **The browser never talks to Databricks.** A public page cannot hold a Databricks
  token, a cold SQL warehouse takes tens of seconds to start, and every page view would
  burn Free Edition quota. The front end reads only the published JSON.
- **Publish is the only exit.** Nothing reaches the front end unless it passes
  `src/schema.py` validation and `check_round()`. A failed validation publishes `stale`
  for that section and keeps the previous document, per the artifact schema.
- **Everything is idempotent.** Re-running any step for the same session gives the same
  tables and the same documents. Retries and backfills are then just re-runs.
- **Spark does the data work, even though the data is small.** Laps from 2018 onward are
  a few hundred thousand rows, and only telemetry is large. Spark is used on purpose, for
  the ETL and the feature tables. Model fitting may drop to pandas after the gold layer
  where the library needs it (PyMC, XGBoost).

## Part 1: Lakehouse

### Where ingest runs

Ingest runs **inside Databricks**, as the first task of the session job. Phase 0
(2026-10-08) showed that Free Edition serverless reaches `livetiming.formula1.com`,
`api.jolpi.ca` and `api.open-meteo.com`, and that a FastF1 `session.load()` completes
there. The job pulls the data, writes Parquet into the Unity Catalog Volume, and the
ETL tasks read it from there. The GitHub Actions runner only triggers the job and runs
publish.

Two conditions on this decision:

- The Free Edition docs describe outbound access as "a limited set of trusted domains",
  so the allow-list can change. `src/ingest/` stays plain Python + FastF1 with no
  Databricks imports, so it can fall back to the GitHub Actions runner (pull, write
  Parquet, `fs cp` to the Volume) without touching the tables.
- **The FastF1 cache cannot live on a Volume.** Its HTTP cache is SQLite, which needs
  random writes and file locks that the Volume FUSE mount does not provide: with the
  cache on a Volume the SQLite file is never created and FastF1 fails with "Failed to
  load any schedule data" (tested 2026-10-08). The job uses the serverless local temp
  disk instead, so every run downloads its session again. That costs seconds per
  session, and each session is ingested about once, so it is not worth working around.

Parquet written for Spark needs two conversions, found in Phase 0: pandas
`datetime64[ns]` columns must be coerced to microseconds (`coerce_timestamps="us"`), and
`Timedelta` columns converted to seconds as `double`. Spark's Parquet reader rejects
nanosecond timestamps and duration types, and serverless does not let you work around it
with reader settings. Without telemetry, FastF1 leaves `LapStartDate` entirely null
(`t0_date` is not loaded), so silver must not use it; session time (`Time`,
`LapStartTime`) is complete, and UTC alignment comes from race control messages.

### Layers

| layer | contents | notes |
|---|---|---|
| raw (Volume) | `SessionTables` per session: `laps`, `results`, `weather`, `track_status`, `session_status`, `race_control` Parquet plus `meta.json`, at `/Volumes/race_preds/raw/fastf1/<season>/<round>/<session_id>/`. Later: Jolpica results and standings, Open-Meteo forecasts. | Written by `src/ingest/fastf1_session.py`. Overwritten on re-ingest; `meta.json` is written last, so a directory without it is an interrupted pull. |
| bronze | `race_preds.bronze.<table>`, one Delta table per raw Parquet file, each row prefixed with `season`, `round`, `session_id` and suffixed with `pulled_at`, `fastf1_version` from `meta.json`. | Written by `src/etl/bronze.py`. A session is replaced as a whole (`overwrite` + `replaceWhere` on the session key), not merged: bronze rows have no natural key (weather, duplicate race control messages). Unpartitioned. `mergeSchema` on. |
| silver | `race_preds.silver.laps` (one row per driver lap) and `race_preds.silver.results` (one row per entrant). snake_case, durations `_s`, Ergast `driver_id` / `constructor_id`. Lap flags `is_green`, `has_yellow` / `has_sc` / `has_vsc` / `has_red` (status string *contains*), `is_in_lap`, `is_out_lap`, `is_deleted`, `is_clean` and `is_quick` (the exact sets `src/laps.py` and `summarize_session` use), `stint_lap`, `fuel_kg` and `lap_time_fuel_corr_s` (R and S only). | Written by `src/etl/silver.py`, Spark-native, window functions per session and per driver stint. A session is replaced as a whole, like bronze. |
| gold | `race_preds.gold.driver_session` (`summarize_session` by_driver), `gold.session` (session_row, the `race_incidents` labels), `gold.stints` (`long_runs`). Later: circuit incident history, rolling driver/team form. | Written by `src/etl/gold.py`. This is what the models read. The pandas functions run unchanged and read **bronze**, since they are written against FastF1's column names; silver is the conformed layer for Spark-native work. `long_runs` needs only laps, so it runs as `groupBy(session).applyInPandas`. `summarize_session` needs six tables at once, which applyInPandas cannot hand to one call, so gold collects one session's tables (a few hundred KB) to the driver. Ids from `silver.results`. |

Telemetry stays out until the lap-level pipeline is working end to end. It is the
expensive load, and none of the four models needs it at first.

### Weekend formats

The backfill reaches 2018, and FastF1 reports four weekend formats in that range. Each
one has a different session order (checked against the FastF1 schedules):

| `EventFormat` | seasons | stage order |
|---|---|---|
| `conventional` | all | FP1 → FP2 → FP3 → Q → R |
| `sprint` | 2021–22 | FP1 → Q → FP2 → S → R |
| `sprint_shootout` | 2023 | FP1 → Q → SQ → S → R |
| `sprint_qualifying` | 2024+ | FP1 → SQ → S → Q → R |

Decisions:

- **Session ids describe what a session does, not what it is called.** Practice 1/2/3 →
  FP1/FP2/FP3, Qualifying → Q, Sprint Qualifying **and Sprint Shootout** → SQ, Sprint
  → S, Race → R. 2021–22 has no SQ: the Friday Qualifying session is Q.
- **Stage order is derived, not hardcoded.** A weekend's order is `pre_weekend`
  followed by its `Session1..5` mapped to ids. The sessions usable at a stage are every
  session up to and including it. This replaces `STAGE_SESSIONS` in the notebook.
- **One module owns the mapping**: `src/sessions.py`, with the name → id table, the
  ordered session list of an event, and the sessions allowed at a stage. The notebook's
  `SESSION_IDS`, `STAGE_SESSIONS` and the hardcoded `"Sprint Qualifying"` in
  `src/results.py` all moved onto it. Ingest, silver and the dispatcher use it too.
- **Historical formats are for training only.** `src/schema.py` stays at `conventional`
  and `sprint_qualifying`, the formats of the season being published. Publish refuses any
  other format. A check asserts that the order derived for these two formats equals
  `schema.STAGE_ORDER`, so the two definitions can't drift apart.
- **Format differences are features.** The race grid comes from Ergast `grid`, never from
  the Q position (on 2021–22 sprint weekends the sprint set the grid). `event_format`, or
  the number of practice sessions before Q, enters the models as a feature.
- Cancelled events and sessions still appear in the schedule. Ingest marks a session
  that fails to load as skipped, which matches the schema's rule that every stage is
  optional.

Exit check: a loop over the 2018–2026 schedules (testing excluded) finds every session
name mapped, every format producing the order above, and 2026 matching
`schema.STAGE_ORDER`. Re-run it before each season to catch new format changes.

Passed on 2026-10-07 with one known exception: **2020 round 13 (Emilia Romagna)** was a
two-day weekend, FP1 → Q → R, but FastF1 still labels it `conventional`. So the table
above is the typical order of a format, not a guarantee. The derived per-event list from
`get_sessions` is authoritative; `ops.processed_sessions` and the backfill must be
filled from it, otherwise they wait forever for an FP2 and FP3 that never existed.

### From exploration code to tables

The exploration modules in `src/` are prototypes of the silver and gold tables, one file
per table:

| function (file) | table | grain |
|---|---|---|
| `get_season_results` (`results.py`) | bronze results | season × round × session × driver |
| `session_timeline` (`timeline.py`) | silver timeline | session × minute |
| `summarize_session` → `by_driver` (`summaries.py`) | gold | driver × session |
| `summarize_session` → `session_row` (`summaries.py`) | gold | session; the `race_incidents` label source |
| `long_runs` (`long_runs.py`) | gold | driver × stint |
| `weekend_features` (`features.py`) | features | driver × round × stage |

`sessions.py` holds what they share: the weekend formats and `session_window`.

How they run on Spark:

- **Simple transformations are Spark-native**: casts, joins, per-lap flags and window
  functions. This is where the Spark practice happens.
- **Complex per-session logic is not rewritten.** `summarize_session` and
  `session_timeline` run through `groupBy(season, round, session).applyInPandas(...)`,
  which sends each session's rows to the existing pandas code in parallel. Knowing when
  to use native operators and when to use a pandas UDF is itself a talking point.
- **Prerequisite refactor (done 2026-10-08):** `applyInPandas` hands a function
  DataFrames, not a FastF1 `Session`. The functions now read a `SessionTables`
  (`src/sessions.py`): six plain DataFrames (laps, results, weather, track status,
  session status, race control) plus season / round / session / format / date, with
  every `Timedelta` column as float seconds. `SessionTables.from_session()` is the
  conversion ingest applies before writing Parquet, and `as_tables()` lets the notebooks
  keep passing a loaded `Session`. FastF1's `Laps.pick_*` filters became plain functions
  in `src/laps.py`, the seed of the silver lap flags. Checked on 20 sessions across four
  weekend shapes: outputs identical to the old code (timeline `Date` differs by 1 ns of
  float rounding), and identical again after a Parquet round trip of the tables.

### State table

`race_preds.ops.processed_sessions` has one row per (season, round, session_id, stage),
with `status` (`succeeded`, `failed`, `not_available`), `updated_at` and the `error` of a
failed run. Stages so far: `ingest`, `bronze`, `silver`, `gold`; scoring and publish add
theirs. Long format, so a new stage needs no schema change and each job task upserts its
own row with a `MERGE` (`src/etl/ops.py`, `track()` wraps a task). The dispatcher (below)
reads it to decide what still needs doing. `not_available` is ingest's
`SessionNotAvailable`: the session has not run yet, retry later.

### Silver assumptions to revisit

- **Ergast ids during a live weekend.** FastF1 fills `DriverId` / `TeamId` only after
  Ergast publishes the round (after the race), and never for sprint qualifying. Silver
  takes them from any session of the same round, so on a weekend in progress they are
  null (checked: 2026 R17 FP1 and SQ had 22 empty ids on race day). `driver`, the
  three-letter code, is always set. Publish does not depend on them: it takes the field
  from FastF1 and fills missing ids by driver code and team name from the previous round
  and the season's Ergast driver list, then maps silver rows by code (Phase 2, checked on
  2026 R17 sprint qualifying, whose 22 FastF1 ids were empty).
- **Fuel correction.** `lap_time_fuel_corr_s = lap_time_s - 0.03 s/kg × fuel_kg`, with the
  start fuel burned linearly to zero over the session's laps. Start fuel is 110 kg to
  2025 and **70 kg from 2026, an approximation**: the 2026 rules limit fuel energy, not
  mass. Sprints get 100/305 of it. Practice and qualifying are not corrected, their
  fuel loads are unknown. Revisit both numbers when fitting the degradation model.

## Part 2: Models

Each prediction section in the schema has one model. Start every model as a trivial
baseline so the full chain runs, then replace it:

| section | baseline | target model |
|---|---|---|
| `qualifying` | order by recent qualifying average | pace from practice long/short runs + form prior |
| `finishing_order` | order by grid (or by qualifying prediction before Q) | full position distribution per driver, including `p_dnf` |
| `race_incidents` | circuit historical SC/VSC/red flag rates | rates adjusted for weather and circuit features |
| `strategy` | most common historical strategy at the circuit | tyre degradation model (hierarchical, with an era effect for 2026) + pit loss → simulated race time per strategy |

Training runs weekly (Monday). Each run logs to MLflow and registers a version. Scoring
runs after every session and loads whichever version is marked for production.
`model.calibrated` stays `false` until a backtest reliability curve justifies `true`.

Race incident labels come from `summarize_session`'s session row and nowhere else.
Counting rule: every status period active at any point between the session's first
`Started` and last `Finished` counts once. A wet start behind the safety car counts as
one SC, SC → red flag → SC counts as two SCs and a red flag, and a red flag after the
finish does not count. Known source gap: 2021 Belgium has no SC status at all in
FastF1's track status, laps or race control (only a pre-start message saying the
formation lap would run behind the SC), so it labels as 0 SC.

Notes on the degradation model:

- Fuel burn and tyre age both rise with lap number and are collinear. Fix fuel
  correction from a prior (roughly 0.03 s/kg) instead of estimating both freely.
- Compound choice is a team decision, so raw compound comparisons carry selection bias.
- 2026 changed cars and tyres. Pre-2026 data enters as a weak prior through the era
  level, not pooled flat.
- An undercut / what-if analysis is a model-based simulation (degradation + pit loss +
  gap). It is not a causal estimate from observed undercuts.

### Compute per section

Weather, circuit info and facts need no model. Qualifying and race incidents are one
model each and cheap to score. Two sections are heavy on every refresh, because they
run one model many times:

| section | per refresh | parallelism |
|---|---|---|
| `finishing_order` | Monte Carlo over thousands of simulated races, to fill `position_probs` and `p_dnf` | Spark, sharded by simulation batch (`mapInPandas`) |
| `strategy` | candidate strategies (compound sequence × pit laps) × SC scenarios × drivers, plus any precomputed what-if grid | Spark, sharded by driver or strategy |

Both run in minutes on Free Edition. Running *many different models* happens offline:
backtests over seasons × stages × model versions, hyperparameter search and feature
experiments. That is where the research swarm (Phase 3b) works.

### Research swarm (agentic, offline only)

Agents never run inside the race-weekend refresh. That path has to be deterministic,
idempotent and schema-valid, and it runs to a deadline. Its parallelism is Spark's job.

Agents fit the offline research loop:

```
frozen evaluation harness (backtest split + metrics + baselines)
        ↓
N agents, each in an isolated sandbox:
   propose one change (feature / model / prior) → run the backtest → log to MLflow
        ↓
reviewer agent: compares against the baseline, checks for leakage, writes a verdict
        ↓
owner approves → model registry → Monday training picks it up
```

- **Sandboxes don't need Spark.** Gold and feature tables are a few MB. Each sandbox gets
  a Parquet snapshot and runs pandas locally, so it is cheap, isolated and costs no Free
  Edition quota. MLflow logs to Databricks from outside with a token. The winning change
  is then ported into the Databricks job.
- **Sandbox runtime** is open: a GitHub Actions matrix (one job per agent), containers,
  or local worktrees.
- **Guardrails:**
  - One holdout season that no agent ever sees, scored once at the end. Without it, dozens
    of agents trying variants overfit the backtest.
  - The evaluation code and the splits are read-only. Agents change only model and
    feature code.
  - A per-agent budget for experiment count and spend.
  - Every feature passes the stage check from `src/sessions.py` (only sessions up to the
    stage).
- It answers the open question about model approval: new versions go live only after
  the owner approves them.

Prerequisite: the evaluation harness from Phase 3. Without fixed metrics the agents have
nothing to optimise.

## Part 3: Dashboard

No application server. The static host serves HTML/JS plus the published JSON. The
browser fetches `index.json` → `manifest.json` → section documents and does all
interaction locally: switching stages, filtering drivers, heatmaps, hover. The layout is
specified in `docs/artifact-schema.md`.

Build against `docs/examples/v1/` until real output exists, which means this part can
proceed in parallel with Parts 1–2.

### Front end and hosting (decided)

- **Code: React, designed once in Lovable, then owned here.** Lovable produces the first
  design and code. The code is copied into `web/` and maintained in this repo from then
  on. There is no ongoing Lovable sync. All data fetching lives in one module, typed from
  `docs/schema/*.schema.json`, with a configurable base URL.
- **Hosting: GitHub Pages**, deployed by a GitHub Actions workflow
  (`actions/upload-pages-artifact` + `actions/deploy-pages`), not from a branch. Published
  JSON is never committed to git.
- **One deploy = front end + data.** The deploy job builds `web/`, copies the full
  published tree into `dist/data/v1/`, and deploys the result. Front end and data share
  one origin (no CORS), and every deploy is a consistent snapshot. A bad publish is
  rolled back by redeploying the previous run.
- **Source of truth for published JSON** is the asset `published-v1.tar.gz` of the GitHub
  Release tagged `published` (decided 2026-10-11, replacing a Volume folder): one
  tarball of the whole v1 tree, replaced by every publish (`scripts/site_release.sh
  upload`, which runs `scripts/check_site.sh` first). Each Pages deploy replaces the whole
  site, so the deploy job downloads the entire tree, including earlier stage snapshots.
  A Release keeps both the deploy and a publish on the runner free of Databricks, which
  is what the fallback path needs; the repo is public, so downloading needs no token.

GitHub Pages specifics to handle:

- **Base path.** A project site is served at `https://<user>.github.io/race-preds/`. Set
  Vite's `base` to `/race-preds/`. Lovable apps assume `/`, so asset paths break without it.
  It's a single page, so no router fallback is needed.
- **Fixed 10-minute cache.** Pages sets `max-age=600`, and response headers can't be
  changed. So:
  - fetch `index.json` and `manifest.json` with a cache-busting query (`?t=<now>`)
  - fetch section documents with `?v=<manifest updated_at>`

  Stage snapshot files never change after publish, so caching them is harmless.
- **The repo must be public** for Pages on the free plan. That matches a public dashboard.
- Pages limits (1 GB site, soft bandwidth cap) are far above this site's size. A deploy
  per finished session (a dozen per weekend) is well within normal use.

A server-side compute path is needed only if the page offers free-form what-ifs (e.g. "if
this driver pits on lap 18"). Options, in order of preference:

1. Precompute a grid of scenarios and publish it in the JSON.
2. Export the model parameters and evaluate a simple model in the browser.
3. A serverless function (e.g. Cloudflare Worker) reading exported parameters.

None of these calls Databricks at request time.

## Automation

### Dispatcher

A single scheduled GitHub Actions workflow, every 30 minutes Thu–Mon (a lower cadence
off-weekend). Each run:

1. Reads the season schedule from FastF1 (session start times, weekend format).
2. Compares finished sessions against `ops.processed_sessions`.
3. For each finished, unprocessed session: trigger the Databricks ingest + ETL + scoring
   job and wait → publish (download the released tree, add the stage, check it, upload it
   with `scripts/site_release.sh`) → deploy (`gh workflow run pages.yml`, which
   downloads the tree, builds `web/` and deploys to GitHub Pages).
4. If FastF1 data is not available yet (usually 30–60 min after a session ends), leaves
   the session pending for the next run.
5. Refreshes the weather forecast every few hours regardless of sessions.

Fixed-time jobs: Thursday `pre_weekend` build, Monday retraining.

The GitHub runner triggers Databricks jobs through the Databricks CLI (`bundle run`) or
the Jobs API. Jobs and their notebooks are defined as code in a Databricks Asset Bundle
under `databricks/`.

What publishes when is already specified in `docs/artifact-schema.md` (Stages and the
weekend lifecycle). The dispatcher just maps a finished FastF1 session to its stage.

### Fallback when Databricks is unavailable

**Decided: Databricks stays.** The data would fit on a GitHub runner. Databricks is kept
on purpose for the Spark / Delta / Unity Catalog / MLflow work, which is the point of the
project. Free Edition has no SLA and can stop compute for the day (see Known
constraints), so the race-weekend path must not depend on it alone.

**Runner path.** When the Databricks job can't run, the dispatcher scores the session on
the GitHub runner with the same `src/` code:

1. FastF1 → `SessionTables`
2. the pandas functions (`laps`, `summaries`, `long_runs`, `features`)
3. score with the production model
4. publish → deploy

This works because the exploration modules are platform-agnostic. Spark-only steps have
no part in it.

- **Trigger:** the job fails to start (quota, expired token, API error), fails, or runs
  past a timeout (30 min). The dispatcher falls back for that session and says so in the
  run summary and the failure email.
- **What the runner needs without Databricks**, mirrored to GitHub Release assets on
  every successful run:
  - the production model, exported from MLflow when a version is approved
  - a Parquet snapshot of the gold/feature history the features read (form, circuit
    history), refreshed after Monday training
  - the full published tree (`published-v1.tar.gz`, release `published`), so a deploy
    still contains every earlier snapshot. This is also the normal path, not only the
    fallback (see Part 3)
- **Reconcile.** The runner can't write `ops.processed_sessions` while Databricks is
  down. It records the session in a fallback log in the release, and the next healthy
  dispatcher run re-processes it on Databricks. That run is idempotent and overwrites
  the fallback documents, so Delta stays complete.
- **Not covered:** Monday training and backfills are Databricks-only. If they can't run,
  the previous model version stays in production.
- **Cost of the fallback:** silver is Spark-native, so the runner path uses the pandas
  equivalents (`laps.py` filters, the exploration modules). The two can drift, so a
  parity check guards them (Phase 2b).

### Known constraints

- GitHub cron can run 5–20 min late. Irrelevant here.
- Free Edition allows **5 concurrent job tasks** per account. The dispatcher processes
  one session at a time; a backfill must not fan out into parallel job runs. Spark's
  own parallelism inside a task (`mapInPandas`, `applyInPandas`) is unaffected.
- One SQL warehouse (2X-Small). Cold start measured at 26.7 s for the first query,
  2 s to connect. This is the number behind "the browser never talks to Databricks".
- Over-quota serverless usage stops compute for the rest of the day, in extreme cases
  the month. Data and settings survive. The quota itself is not published. The
  race-weekend path falls back to the GitHub runner (see Fallback when Databricks is
  unavailable).
- Personal access tokens expire. Note the expiry date when creating the one in GitHub
  Actions secrets; an expired token makes the dispatcher fail silently until the
  failure email arrives.
- Scheduled workflows in a public repo are disabled after 60 days without commits. Keep
  a monthly off-season heartbeat, or re-enable before the season.
- Failed runs email the repo owner. That is the monitoring for now.
- Manual intervention is needed only for a failed run that retries cannot fix, and to
  approve a new model version before scoring uses it (decided: no automatic promotion).

### Secrets

The Databricks host and token live in GitHub Actions secrets and in a local `.env`
(gitignored). The same token never goes into front-end code or the published JSON.

### Phase 2 notes

What exists, in `src/`:

- `dispatch/dispatcher.py`: `stage_at(now)` (Thursday build 20 h before FP1, then each
  session 2 h after its start, races 3 h) and `dispatch(now)`: every session of that stage
  missing from gold in `ops.processed_sessions` is run through the `process_session` job
  (`dispatch/jobs.py`, Databricks SDK, waits up to 30 min, reads the outcome back from the
  state table), then the stage is published. An ingest `not_available` publishes the
  previous stage and leaves the session for the next run.
- `dispatch/replay.py`: the same dispatcher over a fake clock, one call per stage.
- `publish/`: `lakehouse.py` (SQL warehouse reads, limited to the sessions usable at the
  stage), `reference.py` (FastF1 field, Ergast standings and history, Open-Meteo, circuit
  geometry), `documents.py` (one builder per section), `site.py` (manifest, index,
  stale / error fallback, staging copy checked with `check_round` before it replaces the
  published round).
- `models/baselines.py`: the four baselines of Part 2, pure functions. For now they are
  scored inside publish, on the machine running the dispatcher; scoring moves into a
  Databricks task with predictions tables when the MLflow models replace them (Phase 3).

Exit check: `python -m src.dispatch.replay 2026 15` cleared the round, triggered the job
for all five Baku sessions (none were in the lakehouse), and published six stages; the
round passes `python -m src.schema check` and the state table has 20 `succeeded` rows.
2026 R16 replays as well (no jobs, already processed). A forced model failure keeps the
last snapshot as `stale`, and a section that never succeeded publishes `error`; both pass
the check.

Decisions and known gaps:

- **The field** is the latest session run this weekend except FP1 (rookies stand in
  there), before that the previous round's race. The first replay stopped at Q because
  R14 → R15 swapped Tsunoda for Hadjar and the check rejected an unknown driver id. A
  `pre_weekend` or FP1 snapshot can still name last round's driver; a season opener has
  no previous round and fails.
- **Race laps** are the most common winner's lap count of the last three races at the
  circuit; only a new circuit falls back to 305 km over the lap length measured by
  telemetry, which reads a little short (Baku 52 instead of 51).
- **Circuit geometry** is reference data, built once from any FastF1 session at the
  circuit with telemetry (this event first, then three seasons back) and cached in
  `data/processed/circuits/<id>.json`. It is the only telemetry load in the pipeline.
- **Weather** for a past date comes from Open-Meteo's historical-forecast API, which
  archives the forecast, so a replay does not see the observed weather. `issued_at` is
  left empty.
- **Race strategies** leave out a driver with a stint FastF1 has no compound for (4 of 22
  on 2026 R16) rather than inventing one.
- **Not done in Phase 2:** the scheduled GitHub Actions workflow that calls `dispatch`
  with the real clock and picks the round. Publish writes to a local `v1` tree
  (`outputs/site/v1`); `scripts/site_release.sh upload outputs/site/v1` releases it and
  the Pages workflow deploys it (Phase 2b, step 1).

## Proposed layout

```
src/
  config.py, schema.py   existing
  sessions.py            weekend formats: session name → id, derived stage order
  ingest/                FastF1 / Jolpica / Open-Meteo pulls → Parquet → Volume upload
  lakehouse/             Databricks connection, catalog/schema/table definitions
  etl/                   Spark bronze → silver → gold
  features/              Spark feature tables from gold
  models/                one module per prediction section
  publish/               predictions tables → schema-validated JSON
  dispatch/              schedule + state table → what to run now
databricks/              Asset Bundle: databricks.yml, job definitions, notebooks
web/                     front end: React (from Lovable), built and deployed to GitHub Pages
.github/workflows/       dispatcher, weekly training, deploy
```

## Phases

Each phase has an exit check. Don't start the next one until it passes.

**Next up**, in order:

1. ~~Build `src/sessions.py` and pass its exit check.~~ Done 2026-10-07.
2. ~~Phase 0.~~ Done 2026-10-08, see Phase 0 results below.
3. ~~Refactor the exploration modules to take tables instead of a `Session`.~~ Done
   2026-10-08.
4. Phase 1, on 2026 R16 (Bahrain, conventional, 22 cars). The bundle job
   `process_session` (parameters season / round / session_id) runs one task per layer;
   ingest passes its output directory to the next task as a task value.
   - **Ingest, done 2026-10-08.** `src/ingest/fastf1_session.py` writes the raw layer in
     about 30 s on serverless; the SQL warehouse reads all six tables with the expected
     types (durations `double`, `Deleted` `boolean`, UTC timestamps `timestamp_ntz`). A
     re-pull writes byte-identical Parquet. A session that has not run, or does not
     exist in that weekend, raises `SessionNotAvailable` and writes nothing.
     FastF1 leaves some race control columns (`Lap`, `Status`, `RacingNumber`,
     `Sector`) all-None in most sessions, which Parquet stores as the null type that
     Delta rejects; ingest writes them with fixed types (`FIXED_TYPES`) and fails loudly
     on any other all-empty column. 25 sessions across five weekends then share one
     schema per table.
   - **Bronze, done 2026-10-11.** `src/etl/bronze.py`, Spark only. Ingest + bronze take
     about 2 min per session. Checked on R and FP1: row counts equal the Volume files,
     re-running R gives zero differing rows (`EXCEPT ALL` both ways on Delta time
     travel, `pulled_at` excluded), and writing FP1 leaves every R row unchanged.
   - **Silver, done 2026-10-11.** `src/etl/silver.py`, third task of the job, about
     30 s. Checked on R and FP1 against the pandas code: `is_clean` and `is_quick` select
     exactly the laps of `src/laps.py`, per-driver `clean_lap_median` from silver equals
     `summarize_session`, `stint_lap` runs 1..n in every stint, no null ids, and
     re-running R gives zero differing rows.
   - **Gold and the state table, done 2026-10-11.** `src/etl/gold.py`, fourth task;
     `src/etl/ops.py` records every task in `ops.processed_sessions`. A full session
     (ingest → bronze → silver → gold) takes about 2–4 min. Bronze gained a `sessions`
     table (name, format, scheduled start from `meta.json`), which `summarize_session`
     needs. Two type fixes came out of it: `summarize_session` now fills
     `clean_laps` with 0 like the other counts (it was float whenever one driver had no
     clean lap, int otherwise, and Delta refuses to merge the two), and `long_runs`
     returns typed columns even when empty.
   - **Exit check passed 2026-10-11.** All five Bahrain sessions processed. Every gold
     table equals the pandas functions run locally on the same session, column by
     column. A full re-run of R left the R rows of all twelve bronze, silver and gold
     tables identical (`pulled_at` excluded). All 20 session × stage rows in the state
     table are `succeeded`.
5. ~~Phase 2, replay.~~ Done 2026-10-11, see Phase 2 notes below.

| # | phase | exit check |
|---|---|---|
| 0 | **Platform spike.** Connect to the workspace locally, create catalog/schema/volume, upload one Parquet file. In a Databricks notebook, try a FastF1 `session.load()`. Read a table back locally with the SQL connector. Trigger a job from outside with a token. | **Passed 2026-10-08.** Answers below. |
| 1 | **Lakehouse, one race.** Ingest one historical race, build bronze → silver → gold with Spark, add `ops.processed_sessions`. | **Passed 2026-10-11** on 2026 R16, all five sessions. |
| 2 | **Replay.** Run the dispatcher against a past weekend by faking the clock, session by session, with baseline models and a real publish step. | **Passed 2026-10-11** on 2026 R15 (`python -m src.dispatch.replay 2026 15`). |
| 2b | **Fallback path.** The runner path from Automation, with the model, gold snapshot and published tree mirrored to Release assets. **Step 1 done 2026-10-11:** the published tree lives in the `published` release and Pages deploys it (examples until the first upload). Next: runner-side `SessionTables` reads instead of the SQL warehouse, the gold history snapshot, the parity check. | A replayed weekend with Databricks unreachable (invalid token) publishes a valid round on the runner alone. On a normal replay, runner-path features and predictions match the Databricks path within a small tolerance. |
| 3 | **Backfill + models.** Backfill 2018 → now. Replace the baselines one section at a time, with MLflow tracking and a season-split backtest. | Each model beats its baseline on the backtest. Calibration decided per model. |
| 3b | **Research swarm** (optional). Parallel agents in sandboxes propose and backtest model changes against the frozen harness (see Research swarm). | A swarm-proposed change beats the production model on the backtest **and** on the untouched holdout season, and goes live through owner approval. |
| 4 | **Front end** (parallel from the start). Lovable design → copy into `web/`, build against `docs/examples/v1/`, deploy to GitHub Pages, then point at real output. **Status:** live at https://lizhezhao.github.io/race-preds/ with the example round (`.github/workflows/pages.yml`); real output once the first tree is uploaded to the `published` release. | Page renders every section status (`ready`, `stale`, `pending`, `error`, `not_applicable`). |
| 5 | **Go live.** Enable the schedule for the current season. | One real weekend published end to end with no manual step. |

### Phase 0 results

Everything measured on Free Edition, 2026-10-07/08.

| question | answer |
|---|---|
| Serverless outbound network | Yes. Jolpica, Open-Meteo and livetiming all reachable; `session.load(telemetry=False)` for 2025 R1 completed in a job. |
| External job trigger | Yes, both ways. CLI `bundle run`: 41 s for a job that pip-installs FastF1 and loads one session. SDK `jobs.run_now(...).result()`: 32 s. Dispatcher will use the SDK. |
| Own catalog | Allowed. `race_preds` catalog, `raw` schema, `fastf1` Volume created with plain SQL. |
| Volume upload from outside | Works with `databricks fs cp`. One race's laps ≈ 88 KB as Parquet. |
| Local read with SQL connector | Works. Needs host, PAT and the warehouse HTTP path from `.env`. |
| Concurrent job tasks | 5 per account. |
| SQL warehouse | One, 2X-Small. |
| Model Serving | Available, CPU only, limited endpoint count, no batch inference. Not needed by the plan. |
| Vector Search | One endpoint, one search unit. Not needed by the plan. |
| Account level | No account console, no account APIs, one workspace. Everything is workspace-level; a workspace PAT is all GitHub Actions needs. |
| Serverless quota | Not published. Over-use stops compute for the day. |

Spike assets: `databricks/` holds the Asset Bundle (`databricks.yml` from the
`default-python` template, catalog `race_preds`, no personal schemas) and the `spike`
job with its network-check notebook. The bundle's `dev` target prefixes job names with
`[dev <user>]`.

## Backlog

Ideas deliberately left out of the phases above. Pick up only after Phase 4 has a
working front end.

- **Animated flag map.** A circuit map whose marshal sectors light up yellow / red as the
  session plays back minute by minute, with SC / VSC and race control messages alongside.
  - Already exists: `session_timeline()` in `src/timeline.py`, which has one row per
    minute with track status, session status, cars on track and race control messages.
  - Still needed:
    1. Parse sector-scoped flags from race control (`Scope == "Sector"`, the `Sector`
       column, `"YELLOW IN TRACK SECTOR 3"` / `"CLEAR IN TRACK SECTOR 3"`). Turn them into
       an active-flag set per sector per minute.
    2. Build the circuit geometry: the outline from one lap's `get_pos_data()` X/Y
       (needs `telemetry=True`, so build it once per circuit and cache it), plus
       `get_circuit_info()` marshal sectors and `rotation`. Marshal sectors are marker
       points, not segments, so assign outline points to sectors by distance along
       the lap.
    3. Publish a new document type for it. That means an edit to `src/schema.py` and
       `docs/artifact-schema.md`, then re-exporting the schema and examples.
    4. Animate it in the front end.
  - Without telemetry the timeline aligns race control messages (UTC) through the
    chequered flag. That was within ~2 s of the telemetry anchor on 2025 sessions. The
    scheduled start is only a last resort: races were 3–18 min off with it.

Out of scope for now: LLM-generated content (narrative fun facts) and live Q&A
(text-to-SQL, RAG over the regulations). Live Q&A would also need a backend, which the
static architecture rules out.

## Open questions

- Data source for the Pirelli tyre allocation (not in FastF1).
- Research swarm sandbox runtime: GitHub Actions matrix, containers or local worktrees.
