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
        │  ① ingest                      (GitHub Actions runner)
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

Ingest is planned on a GitHub Actions runner, **outside** Databricks. Databricks Free
Edition serverless compute probably has restricted outbound internet access, which the
FastF1 live-timing endpoint and Open-Meteo both need. The runner pulls the data, writes
Parquet, and uploads it to a Unity Catalog Volume. If Phase 0 shows serverless can reach
those hosts, ingest can move into Databricks later without changing the tables.

### Layers

| layer | contents | notes |
|---|---|---|
| raw (Volume) | Parquet per session as FastF1 returns it: laps, results, weather, track status, race control messages. Jolpica results and standings. Open-Meteo forecasts. | Path keyed by season / round / session. Overwritten on re-ingest. |
| bronze | The raw files loaded into Delta, one table per source entity, plus ingest metadata (source, pulled_at, FastF1 version). | Append/merge by session key. Schema evolution on. |
| silver | Cleaned and conformed: typed columns, Ergast ids as join keys, lap flags (in-lap, out-lap, SC/VSC/red flag via `TrackStatus` contains), stint number and tyre age per lap, fuel-corrected lap time. | Window functions per driver-session live here. |
| gold | Analysis grain tables: driver × session pace summaries, driver × race × stint degradation, circuit incident history, rolling driver/team form. | This is what the models read. |

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
- **Prerequisite refactor:** `applyInPandas` hands a function DataFrames, not a FastF1
  `Session`. Before Phase 1, change these functions to take the tables they read (laps,
  track status, session status, weather, race control messages, results) instead of a
  `session`. A thin wrapper can keep the notebook calling them with a session.

### State table

`ops.processed_sessions` records, per (season, round, session): the ingest, ETL, scoring
and publish status, timestamps, and the last error. The dispatcher (below) reads it to
decide what still needs doing.

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

Hosting candidates: GitHub Pages, Cloudflare Pages (free, deploy on push). Framework is
still undecided. Build against `docs/examples/v1/` until real output exists, which means
this part can proceed in parallel with Parts 1–2.

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
3. For each finished, unprocessed session: ingest → trigger the Databricks ETL + scoring
   job and wait → publish → deploy.
4. If FastF1 data is not available yet (usually 30–60 min after a session ends), leaves
   the session pending for the next run.
5. Refreshes the weather forecast every few hours regardless of sessions.

Fixed-time jobs: Thursday `pre_weekend` build, Monday retraining.

The GitHub runner triggers Databricks jobs through the Databricks CLI (`bundle run`) or
the Jobs API. Jobs and their notebooks are defined as code in a Databricks Asset Bundle
under `databricks/`.

What publishes when is already specified in `docs/artifact-schema.md` (Stages and the
weekend lifecycle). The dispatcher just maps a finished FastF1 session to its stage.

### Known constraints

- GitHub cron can run 5–20 min late. Irrelevant here.
- Scheduled workflows in a public repo are disabled after 60 days without commits. Keep
  a monthly off-season heartbeat, or re-enable before the season.
- Failed runs email the repo owner. That is the monitoring for now.
- Manual intervention is needed only for a failed run that retries cannot fix, and to
  approve a new model version before scoring uses it (decided: no automatic promotion).

### Secrets

The Databricks host and token live in GitHub Actions secrets and in a local `.env`
(gitignored). The same token never goes into front-end code or the published JSON.

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
web/                     front end (after framework is chosen)
.github/workflows/       dispatcher, weekly training, deploy
```

## Phases

Each phase has an exit check. Don't start the next one until it passes.

**Next up**, in order:

1. Build `src/sessions.py` and pass its exit check (see Weekend formats). Without it the
   backfill breaks on the 2021–23 sprint weekends.
2. Phase 0.
3. Before Phase 1, refactor the exploration modules to take tables instead of a
   `Session` (see From exploration code to tables).

| # | phase | exit check |
|---|---|---|
| 0 | **Platform spike.** Connect to the workspace locally, create catalog/schema/volume, upload one Parquet file. In a Databricks notebook, try a FastF1 `session.load()`. Read a table back locally with the SQL connector. Trigger a job from outside with a token. | Written answers to: can serverless reach the internet? Can a job be triggered externally on Free Edition? What are the Vector Search / model serving / job quotas? |
| 1 | **Lakehouse, one race.** Ingest one historical race, build bronze → silver → gold with Spark, add `ops.processed_sessions`. | Gold tables for that race. Re-running produces identical tables. |
| 2 | **Replay.** Run the dispatcher against a past weekend by faking the clock, session by session, with baseline models and a real publish step. | A full round directory that passes `python -m src.schema check`, produced without manual steps. |
| 3 | **Backfill + models.** Backfill 2018 → now. Replace the baselines one section at a time, with MLflow tracking and a season-split backtest. | Each model beats its baseline on the backtest. Calibration decided per model. |
| 3b | **Research swarm** (optional). Parallel agents in sandboxes propose and backtest model changes against the frozen harness (see Research swarm). | A swarm-proposed change beats the production model on the backtest **and** on the untouched holdout season, and goes live through owner approval. |
| 4 | **Front end** (parallel from the start). Choose framework and host, build against `docs/examples/v1/`, then point at real output. | Page renders every section status (`ready`, `stale`, `pending`, `error`, `not_applicable`). |
| 5 | **Go live.** Enable the schedule for the current season. | One real weekend published end to end with no manual step. |

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

- Databricks Free Edition limits: outbound network, external job triggers, compute and
  job quotas. Phase 0 answers these.
- Front-end framework and host.
- Data source for the Pirelli tyre allocation (not in FastF1).
- Research swarm sandbox runtime: GitHub Actions matrix, containers or local worktrees.
