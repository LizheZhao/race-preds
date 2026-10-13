# Pipeline plan

How data gets from FastF1 to the public dashboard, and how the chain refreshes itself
during a race weekend without anyone touching it. This is a living plan: the status and
the next steps come first, then the decisions, then the design of each part, and the
records of finished phases last. Update it as decisions land.

The repo has three parts:

1. **Lakehouse**: ingest FastF1 / Jolpica / Open-Meteo, then Spark ETL into Delta tables
   on Databricks (bronze → silver → gold).
2. **Models**: finishing order, qualifying, race incidents (SC/VSC/red flag), tyre
   strategy. They are trained and scored on Databricks and tracked in MLflow.
3. **Dashboard**: a static front end that reads JSON documents conforming to
   `src/schema.py` (see `docs/artifact-schema.md`). Live at
   https://lizhezhao.github.io/race-preds/.

## Status and next steps

As of 2026-10-13.

| # | phase | status |
|---|---|---|
| 0 | Platform spike | **Done** 2026-10-08 (Phase 0 results) |
| 1 | Lakehouse for one race | **Done** 2026-10-11 on 2026 R16 (Phase 1 record) |
| 2 | Replay | **Done** 2026-10-11 on 2026 R15 (Phase 2 record) |
| 2b | Fallback path | **Narrowed** 2026-10-13: release-hosted tree done; runner-side ingest deferred (runners can't reach F1 live timing). The rest folds into Phase 3 |
| 3 | Backfill + models | **Next.** Plan written 2026-10-13 (Phase 3 plan) |
| 3b | Research swarm (optional) | Not started |
| 4 | Front end | Live with real 2026 R15–R17 since 2026-10-13, including prediction vs result |
| 5 | Go live | Built and dry-run in CI 2026-10-13; first real publish 2026-10-22 21:30 UTC |

**Order for the rest of 2026: go live first, models after** (decided 2026-10-12). Six
rounds are left (R18 Austin, FP1 2026-10-23, through R23 Abu Dhabi on 2026-12-06).
Building real models first would likely miss the live season, so the site goes live
with the baselines. While `model.calibrated` is `false`, the front end shows them as
model scores, as designed.

**Next up**, in order:

1. **Go live with baselines before 2026-10-22 21:30 UTC**, the R18 `pre_weekend` build:
   - ~~build `src/dispatch/run.py` and `.github/workflows/dispatch.yml`~~ built 2026-10-12
     (Automation → Dispatcher), on `main` since 2026-10-13
   - ~~add the Databricks secrets and record the PAT's expiry date~~ done 2026-10-13;
     `PROCESS_SESSION_JOB_ID` stays unset while the dev job is the only one
   - ~~dry run steps 1–2~~ done 2026-10-13 in CI (R17, and R18's Thursday build);
     step 3, a quiet scheduled run, comes Thursday 2026-10-15
   - let the Thursday R18 build be the first real publish
2. **Phase 3** between race weekends (Tuesday and Wednesday only), in the order of the
   Phase 3 plan: backfill, feature table, evaluation harness, then `finishing_order`.
   Grading the baselines starts with the first live round, so the 2026 rounds become the
   first real record of predictions against outcomes.
3. **Phase 2b stays narrowed** (Decisions, 2026-10-13). Its two cheap parts ride along
   with Phase 3: champions exported to a Release asset, and scoring that runs without
   Spark.
4. **Before the off-season** (after 2026-12-06):
   - keep the schedule from being disabled (60 days without commits)
   - re-run the `sessions` check against the 2027 schedule before the season

## Decisions

The decisions that shape everything below, newest first. Details are in the sections they
point to.

- **Phase 2b is narrowed; a Databricks failure is handled by retry, not by a runner
  pipeline** (2026-10-13). GitHub-hosted runners get 403 from F1 live timing, so the
  runner can't ingest a session. When a Databricks job fails, the dispatcher publishes the
  last complete stage, the run fails and GitHub emails the owner. The next scheduled run
  30 minutes later retries, since every step is idempotent. The owner steps in only when
  failures repeat (expired token, daily quota). Runner-side ingest is deferred; the
  options are in Automation → Fallback.
- **Model scoring stays in publish, without Spark** (2026-10-13). Each champion is
  exported from MLflow to a Release asset, and publish scores it with pandas and numpy,
  like the baselines today. A Monte Carlo over 22 drivers is milliseconds. Spark's work in
  Phase 3 is the backfill, the feature table and the backtest grid. (Phase 3 plan)
- **Model selection is automatic** (2026-10-12). Each Monday the candidate that predicted
  the latest rounds best becomes `champion`, with gates and a margin. No manual approval.
  The owner's gate is merging model code. (Part 2 → Weekly model check)
- **Go live before real models** (2026-10-12). (Status and next steps)
- **Databricks stays, with a runner fallback** (2026-10-12). Databricks is kept on
  purpose for the Spark / Delta / Unity Catalog / MLflow work; the data alone would fit
  on a GitHub runner. The race-weekend path must not depend on it alone, so scoring and
  publish stay runnable without Spark. (Automation → Fallback)
- **The published tree lives in a GitHub Release** (2026-10-11), not a Volume folder. It
  keeps deploy and fallback publishing free of Databricks. (Part 3)
- **Front end: React, designed once in Lovable, owned here, on GitHub Pages**
  (2026-10-11). (Part 3)
- **Ingest runs inside Databricks** (2026-10-08, after Phase 0). (Part 1 → Where ingest
  runs)
- **Session ids describe what a session does; historical formats are for training
  only** (2026-10-07). (Part 1 → Weekend formats)
- **Race incident label rule**: every status period active inside the session window
  counts once. (Part 2)
- **No application server, and the browser never talks to Databricks.** (Ground rules)
- **Out of scope for now:** LLM-generated content (narrative fun facts) and live Q&A
  (text-to-SQL, RAG over the regulations). Live Q&A would also need a backend, which the
  static architecture rules out.

## Architecture

```
FastF1 / Jolpica / Open-Meteo
        │  ① ingest                       Databricks job task
        ▼
UC Volume: raw Parquet (SessionTables)
        │  ② Spark ETL                    Databricks job tasks
        ▼
bronze → silver → gold  (Delta)  +  ops.processed_sessions
        │  ③ score                        now: baselines inside publish, on the runner
        │                                 Phase 3: MLflow champion in a Databricks task
        ▼
        │  ④ publish                      GitHub Actions runner (SQL warehouse reads)
        ▼
v1 JSON tree, validated by src/schema.py → GitHub Release "published"
        │  ⑤ deploy                       pages.yml: build web/ + the tree
        ▼
GitHub Pages  ←  browser fetches JSON; all interaction is client-side
```

### Ground rules

- **The browser never talks to Databricks.** A public page cannot hold a Databricks
  token, a cold SQL warehouse takes tens of seconds to start (26.7 s measured), and
  every page view would burn Free Edition quota. The front end reads only the published
  JSON.
- **Publish is the only exit.** Nothing reaches the front end unless it passes
  `src/schema.py` validation and `check_round()`. A section that fails to build publishes
  `stale` and keeps its previous document, per the artifact schema.
- **Everything is idempotent.** Re-running any step for the same session gives the same
  tables and the same documents. Retries and backfills are then just re-runs.
- **Spark does the data work, even though the data is small.** Laps from 2018 onward are
  a few hundred thousand rows, and only telemetry is large. Spark is used on purpose, for
  the ETL and the feature tables. Model fitting may drop to pandas after the gold layer
  where the library needs it (PyMC, XGBoost).
- **Scoring and publish run without Spark**, so the runner fallback can use the same code.

## Part 1: Lakehouse

### Where ingest runs

Ingest runs **inside Databricks**, as the first task of the `process_session` job. Phase 0
showed that Free Edition serverless reaches `livetiming.formula1.com`, `api.jolpi.ca` and
`api.open-meteo.com`, and that a FastF1 `session.load()` completes there. The job pulls
the data and writes Parquet into the Unity Catalog Volume. The ETL tasks read it from
there. The GitHub Actions runner only triggers the job and runs publish.

Two conditions on this decision:

- The Free Edition docs describe outbound access as "a limited set of trusted domains",
  so the allow-list can change. `src/ingest/` stays plain Python + FastF1 with no
  Databricks imports, so it can fall back to the GitHub Actions runner (pull, write
  Parquet, `fs cp` to the Volume) without touching the tables.
- **The FastF1 cache cannot live on a Volume.** Its HTTP cache is SQLite, which needs
  random writes and file locks that the Volume FUSE mount does not provide. With the
  cache on a Volume, the SQLite file is never created and FastF1 fails with "Failed to
  load any schedule data" (tested 2026-10-08). The job uses the serverless local temp
  disk instead, so every run downloads its session again. That costs seconds per
  session, and each session is ingested about once, so it isn't worth working around.

Parquet written for Spark needs two conversions, found in Phase 0:

- pandas `datetime64[ns]` columns are coerced to microseconds
  (`coerce_timestamps="us"`)
- `Timedelta` columns are converted to seconds as `double`

Spark's Parquet reader rejects nanosecond timestamps and duration types, and serverless
doesn't let you work around it with reader settings.

Without telemetry, FastF1 leaves `LapStartDate` entirely null (`t0_date` is not loaded),
so silver must not use it. Session time (`Time`, `LapStartTime`) is complete, and UTC
alignment comes from race control messages.

### Layers

| layer | contents | notes |
|---|---|---|
| raw (Volume) | `SessionTables` per session: `laps`, `results`, `weather`, `track_status`, `session_status`, `race_control` Parquet plus `meta.json`, at `/Volumes/race_preds/raw/fastf1/<season>/<round>/<session_id>/`. Later: Jolpica results and standings, Open-Meteo forecasts. | Written by `src/ingest/fastf1_session.py`. Overwritten on re-ingest. `meta.json` is written last, so a directory without it is an interrupted pull. |
| bronze | `race_preds.bronze.<table>`, one Delta table per raw Parquet file, plus `sessions` (name, format, scheduled start from `meta.json`). Each row is prefixed with `season`, `round`, `session_id` and suffixed with `pulled_at`, `fastf1_version`. | Written by `src/etl/bronze.py`. A session is replaced as a whole (`overwrite` + `replaceWhere` on the session key), not merged: bronze rows have no natural key (weather, duplicate race control messages). Unpartitioned. `mergeSchema` on. |
| silver | `race_preds.silver.laps` (one row per driver lap) and `silver.results` (one row per entrant). snake_case, durations `_s`, Ergast `driver_id` / `constructor_id`. Lap flags `is_green`, `has_yellow` / `has_sc` / `has_vsc` / `has_red` (status string *contains*), `is_in_lap`, `is_out_lap`, `is_deleted`, `is_clean` and `is_quick` (the exact sets `src/laps.py` and `summarize_session` use), `stint_lap`, `fuel_kg` and `lap_time_fuel_corr_s` (R and S only). | Written by `src/etl/silver.py`, Spark-native, window functions per session and per driver stint. A session is replaced as a whole, like bronze. |
| gold | `gold.driver_session` (`summarize_session` by_driver), `gold.session` (session_row, the `race_incidents` labels), `gold.stints` (`long_runs`). Later: circuit incident history, rolling driver/team form. | Written by `src/etl/gold.py`. This is what the models read. Details below. |

How gold is built:

- The pandas functions run unchanged and read **bronze**, since they are written against
  FastF1's column names. Silver is the conformed layer for Spark-native work.
- `long_runs` needs only laps, so it runs as `groupBy(session).applyInPandas`.
- `summarize_session` needs six tables at once, which `applyInPandas` can't hand to one
  call. So gold collects one session's tables (a few hundred KB) to the driver.
- Ids come from `silver.results`.

Telemetry stays out until the lap-level pipeline works end to end. It is the expensive
load, and none of the four models needs it at first. The one exception is circuit
geometry, a cached reference load (Phase 2 record).

### Weekend formats

The backfill reaches 2018, and FastF1 reports four weekend formats in that range. Each
one has a different session order (checked against the FastF1 schedules):

| `EventFormat` | seasons | stage order |
|---|---|---|
| `conventional` | all | FP1 → FP2 → FP3 → Q → R |
| `sprint` | 2021–22 | FP1 → Q → FP2 → S → R |
| `sprint_shootout` | 2023 | FP1 → Q → SQ → S → R |
| `sprint_qualifying` | 2024+ | FP1 → SQ → S → Q → R |

- **Session ids describe what a session does, not what it is called.** Practice 1/2/3 →
  FP1/FP2/FP3, Qualifying → Q, Sprint Qualifying **and Sprint Shootout** → SQ, Sprint
  → S, Race → R. 2021–22 has no SQ: the Friday Qualifying session is Q.
- **Stage order is derived, not hardcoded.** A weekend's order is `pre_weekend`
  followed by its `Session1..5` mapped to ids. The sessions usable at a stage are every
  session up to and including it.
- **One module owns the mapping**: `src/sessions.py`, with the name → id table, the
  ordered session list of an event, and the sessions allowed at a stage. Ingest, silver,
  publish and the dispatcher all use it.
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

Exit check, passed 2026-10-07: a loop over the 2018–2026 schedules (testing excluded)
finds every session name mapped, every format producing the order above, and 2026
matching `schema.STAGE_ORDER`. Re-run it before each season to catch new format changes.

One known exception: **2020 round 13 (Emilia Romagna)** was a two-day weekend, FP1 → Q
→ R, but FastF1 still labels it `conventional`. So the table above is the typical order
of a format, not a guarantee. The derived per-event list from `get_sessions` is
authoritative. `ops.processed_sessions` and the backfill must be filled from it,
otherwise they wait forever for an FP2 and FP3 that never existed.

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

`sessions.py` holds what they share: the weekend formats, `session_window` and
`SessionTables`.

How they run on Spark:

- **Simple transformations are Spark-native**: casts, joins, per-lap flags and window
  functions. This is where the Spark practice happens.
- **Complex per-session logic is not rewritten.** It runs through `applyInPandas` (or a
  per-session collect, see Layers), which sends each session's rows to the existing pandas
  code. Knowing when to use native operators and when to use a pandas UDF is itself a
  talking point.
- **The functions take tables, not a FastF1 `Session`** (refactor done 2026-10-08).
  - They read a `SessionTables`: six plain DataFrames (laps, results, weather, track
    status, session status, race control) plus season / round / session / format / date.
    Every `Timedelta` column is float seconds.
  - `SessionTables.from_session()` is the conversion ingest applies before writing
    Parquet. `as_tables()` lets the notebooks keep passing a loaded `Session`.
  - FastF1's `Laps.pick_*` filters became plain functions in `src/laps.py`, the seed of
    the silver lap flags.
  - Checked on 20 sessions across four weekend shapes: outputs identical to the old
    code (timeline `Date` differs by 1 ns of float rounding), and identical again after
    a Parquet round trip of the tables.

### State table

`race_preds.ops.processed_sessions` has one row per (season, round, session_id, stage),
with `status` (`succeeded`, `failed`, `not_available`), `updated_at` and the `error` of a
failed run.

- Stages so far: `ingest`, `bronze`, `silver`, `gold`. Scoring and publish add theirs.
- Long format, so a new stage needs no schema change. Each job task upserts its own row
  with a `MERGE` (`src/etl/ops.py`; `track()` wraps a task).
- The dispatcher reads it to decide what still needs doing.
- `not_available` is ingest's `SessionNotAvailable`: the session has not run yet, so
  retry later.

### Silver assumptions to revisit

- **Ergast ids during a live weekend.** FastF1 fills `DriverId` / `TeamId` only after
  Ergast publishes the round (after the race), and never for sprint qualifying.
  - Silver takes them from any session of the same round, so on a weekend in progress
    they are null (checked: 2026 R17 FP1 and SQ had 22 empty ids on race day). `driver`,
    the three-letter code, is always set.
  - Publish does not depend on them. It takes the field from FastF1, fills missing ids by
    driver code and team name from the previous round and the season's Ergast driver
    list, then maps silver rows by code. Checked on 2026 R17 sprint qualifying, whose 22
    FastF1 ids were empty.
- **Fuel correction.** `lap_time_fuel_corr_s = lap_time_s - 0.03 s/kg × fuel_kg`, with the
  start fuel burned linearly to zero over the session's laps.
  - Start fuel is 110 kg to 2025 and **70 kg from 2026, an approximation**: the 2026
    rules limit fuel energy, not mass. Sprints get 100/305 of it.
  - Practice and qualifying are not corrected; their fuel loads are unknown.
  - Revisit both numbers when fitting the degradation model.

## Part 2: Models

Each prediction section in the schema has one model. Every model starts as a trivial
baseline so the full chain runs (`src/models/baselines.py`, live now), then gets replaced:

| section | baseline | target model |
|---|---|---|
| `qualifying` | order by recent qualifying average | pace from practice long/short runs + form prior |
| `finishing_order` | order by grid (or by qualifying prediction before Q) | full position distribution per driver, including `p_dnf` |
| `race_incidents` | circuit historical SC/VSC/red flag rates | rates adjusted for weather and circuit features |
| `strategy` | most common historical strategy at the circuit | tyre degradation model (hierarchical, with an era effect for 2026) + pit loss → simulated race time per strategy |

- **Where scoring runs.** Inside publish, on the machine running the dispatcher, for the
  baselines now and for the MLflow champions later. Publish loads each champion from a
  Release asset, so scoring needs neither Spark nor a live Databricks connection
  (Decisions, 2026-10-13).
- **Training cadence.** Training runs weekly (Monday). Each run logs to MLflow and
  registers a version.
- **Which version is live.** Scoring loads the version with the MLflow alias `champion`,
  chosen automatically by the weekly check below.
- **Calibration.** `model.calibrated` stays `false` until a backtest reliability curve
  justifies `true`.

### Weekly model check against the previous round (automatic champion)

Every Monday, before retraining, the round that just finished is used to check which
model predicts best right now. This matters most in 2026: new regulations make older
seasons a weak guide, so the latest rounds are the best evidence available.

1. **Grade the last round.** Score every stage's snapshot against `results.json`. Score
   the shadow predictions of every candidate too (see below). Each section uses one
   proper scoring rule, fixed in advance:
   - `finishing_order` / `qualifying`: ranked probability score on `position_probs`, plus
     log loss of the actual position
   - `race_incidents`: Brier score on SC / VSC / red flag
   - `strategy`: whether the actual winning strategy was the top option or in the top 2

   Log each (model, section, round, stage) score to MLflow, tagged with season and round.
2. **Compare on a rolling window, not one race.** One race is a single outcome for 20–22
   drivers, too noisy to pick a model on. The comparison uses the last 5 rounds of the
   current season, weighted to the most recent. A challenger only counts as better when
   it beats the champion on that window by more than a fixed margin, and it may not be
   worse on the season-split backtest.
3. **Retrain the candidates** on data through the round just graded, so the next round
   is always out of sample. This is walk-forward evaluation, the same rule as the
   backtest.
4. **Select automatically.** The candidate that predicted the latest rounds best becomes
   `champion` without manual approval. Scoring loads that alias, so the next stage
   already uses it.
   - It is a candidate only if it passed the gates: schema-valid output and no worse than
     the baselines on the season-split backtest.
   - The margin in step 2 keeps it from flip-flopping between near-equal models.
   - Every switch is visible in three places: the run summary and email (old → new, with
     the window scores), MLflow (alias history), and the dashboard. Every prediction card
     shows `model.name` and `model.version` in its footer, with the backtest in a popover.
   - Rolling back means pointing the alias at the previous version.
   - Each section selects separately. The finishing-order champion can be a different
     model from the strategy champion.

**Shadow scoring makes the comparison fair.** At every stage the dispatcher scores
every candidate, not just the champion. Only the champion's predictions are published;
the others go to a `predictions_shadow` Delta table. Without this, a challenger could
only be graded on a re-run with hindsight, which flatters it. The baselines stay in the
candidate set permanently as the floor every model has to clear.

Until Phase 3 there are only the baselines. Grading them still starts with the first
live round, so the track record exists before the real models arrive.

### Race incident labels

Race incident labels come from `summarize_session`'s session row and nowhere else.

- **Counting rule:** every status period active at any point between the session's
  first `Started` and last `Finished` counts once.
  - A wet start behind the safety car counts as one SC.
  - SC → red flag → SC counts as two SCs and a red flag.
  - A red flag after the finish doesn't count.
- **Known source gap:** 2021 Belgium has no SC status at all in FastF1's track status,
  laps or race control. There is only a pre-start message saying the formation lap would
  run behind the SC, so it labels as 0 SC.

### Degradation model notes

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
| `finishing_order` | Monte Carlo over thousands of simulated races, to fill `position_probs` and `p_dnf` | none needed: numpy in publish, milliseconds for 22 drivers (Decisions, 2026-10-13) |
| `strategy` | candidate strategies (compound sequence × pit laps) × SC scenarios × drivers, plus any precomputed what-if grid | Spark, sharded by driver or strategy |

Strategy is the one that may need Spark. Running *many different models* happens offline:
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
owner reviews and merges the code → registered as a candidate → Monday check may select it
```

- **Sandboxes don't need Spark.** Gold and feature tables are a few MB. Each sandbox gets
  a Parquet snapshot and runs pandas locally, so it is cheap, isolated and costs no Free
  Edition quota. MLflow logs to Databricks from outside with a token. The winning change
  is then ported into the Databricks job.
- **Guardrails:**
  - One holdout season that no agent ever sees, scored once at the end. Without it,
    dozens of agents trying variants overfit the backtest.
  - The evaluation code and the splits are read-only. Agents change only model and
    feature code.
  - A per-agent budget for experiment count and spend.
  - Every feature passes the stage check from `src/sessions.py` (only sessions up to the
    stage).
- **Code is the owner's gate, not versions.** A swarm change enters the candidate set only
  once the owner merges it. Selecting among candidates is automatic.

Prerequisite: the evaluation harness from Phase 3. Without fixed metrics the agents have
nothing to optimise. The sandbox runtime is an open question.

## Part 3: Dashboard

No application server. The static host serves HTML/JS plus the published JSON. The
browser fetches `index.json` → `manifest.json` → section documents and does all
interaction locally: switching stages, highlighting drivers, heatmaps, hover. The layout
is specified in `docs/artifact-schema.md`. Until real output exists, the site is built
against `docs/examples/v1/`.

### Front end and hosting

- **Code: React, designed once in Lovable, then owned here.** The Lovable code was
  converted to a plain Vite + React single-page app in `web/` (2026-10-11). There is no
  Lovable sync. `web/AGENTS.md` has the conventions.
  - All data fetching lives in `web/src/data/api.ts`, with a configurable base URL.
  - Document types are generated from `docs/schema/*.schema.json` (`npm run gen:types`).
- **Hosting: GitHub Pages**, deployed by `.github/workflows/pages.yml`
  (`actions/upload-pages-artifact` + `actions/deploy-pages`), not from a branch.
  Published JSON is never committed to git.
- **One deploy = front end + data.** The deploy job builds `web/`, copies the full
  published tree into `dist/data/v1/`, and deploys the result.
  - Front end and data share one origin, so there's no CORS.
  - Every deploy is a consistent snapshot.
  - A bad publish is rolled back by redeploying the previous run.
- **Source of truth for published JSON** is the asset `published-v1.tar.gz` of the GitHub
  Release tagged `published`.
  - It is one tarball of the whole v1 tree, replaced by every publish
    (`scripts/site_release.sh upload`, which runs `scripts/check_site.sh` first).
  - Each Pages deploy replaces the whole site, so the deploy downloads the entire tree,
    including earlier stage snapshots.
  - A Release keeps both the deploy and a publish on the runner free of Databricks, which
    is what the fallback needs. The repo is public, so downloading needs no token.
  - Before the first upload, `pages.yml` falls back to the example round.

GitHub Pages specifics, all handled in `web/`:

- **Base path.** The site is served at `https://lizhezhao.github.io/race-preds/`, so
  Vite's `base` is `/race-preds/`. `pages.yml` takes the base path from
  `actions/configure-pages`.
- **Fixed 10-minute cache.** Pages sets `max-age=600`, and response headers can't be
  changed. So `index.json` and `manifest.json` are fetched with a timestamp query, and
  section documents with `?v=<manifest updated_at>`. Stage snapshot files never change
  after publish, so caching them is harmless.
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

**What exists** (`src/dispatch/`, Phase 2):

- `stage_at(season, round, now)` gives the stage the clock has reached.
  - The Thursday `pre_weekend` build happens 20 h before FP1.
  - After that, each session's stage is reached 2 h after its start (races 3 h), when
    FastF1 data is usually there.
- `dispatch(season, round, now, site, run_id)` brings the lakehouse up to that stage and
  publishes it.
  - Every session missing from gold in `ops.processed_sessions` is run through the
    `process_session` job (`jobs.py`, Databricks SDK, waits up to 30 min, reads the
    outcome back from the state table).
  - An ingest `not_available` publishes the previous stage and leaves the session for
    the next run.
- `replay.py` runs the same dispatcher over a fake clock, one call per stage.

What publishes when is specified in `docs/artifact-schema.md` (Stages and the weekend
lifecycle). Jobs and notebooks are defined as code in the Asset Bundle under
`databricks/`.

**Built 2026-10-12: `src/dispatch/run.py`, a CLI around `process()`.** `dispatch()` is
split into `process()` (sessions to gold, returns a `Progress`) and `publish_stage()`, so
the decision to publish comes before anything is rewritten. `replay.py` still calls
`dispatch()`, which does both.

- **`current_round(season, now)`** returns the round whose window contains `now`.
  - The window runs from `pre_weekend_at` to the race's `ready_at` + 24 h. The extra day
    catches post-race penalties that change the classification.
  - Outside every window it returns nothing, and the run exits 0 doing nothing.
  - Back-to-back weekends don't overlap: a race window ends Monday, and the next Thursday
    build starts it again.
- **Publish only on change.** Republishing an unchanged stage would still rewrite
  `generated_at`, upload a new tree and redeploy every 30 minutes. `dispatch()` reports
  whether it ran a job or the stage advanced. `run.py` publishes, uploads and deploys
  only when one of these holds:
  - the stage advanced
  - a session was processed
  - the weather is due: the manifest's `weather.updated_at` is older than 3 h inside the
    window
- **Arguments:** `--now <ISO>` and `--round <n>` override the clock for dry runs.
  `--site <v1 dir>` is where the tree lives. It writes `changed=true|false` and the stage
  to `$GITHUB_OUTPUT`.
- **A failed Databricks job** publishes the last complete stage (if that is a change),
  then fails the run, so the email goes out. The upload and deploy steps run on failure
  too, whenever something was published.

**Built 2026-10-12: `.github/workflows/dispatch.yml`.**

- **Triggers:**
  - `schedule: "*/30 * * * 4,5,6,0,1"` (UTC). Thursday through Monday covers every
    2026 venue, including Las Vegas (Thursday local is Friday UTC) and Sunday races in
    the Americas, whose 3 h ready time lands on Monday UTC.
  - `workflow_dispatch` with optional `now`, `round` and `dry_run` inputs.
- **Concurrency:** `group: dispatch`, `cancel-in-progress: false`. A session job can take
  30 min, so runs queue and never overlap. GitHub keeps one pending run, which is enough.
- **Timeout:** `timeout-minutes: 90`, which allows one session job plus publish.
- **`dispatch` job steps:**
  1. Check out, then set up Python 3.12 with `uv` (`uv pip install --system -r
     requirements.txt`, cached).
  2. `actions/cache` restores `data/fastf1_cache`. Circuit geometry is committed in
     `reference/circuits/` instead, because the runner can't load telemetry (Known
     constraints).
  3. `scripts/site_release.sh download outputs/site/v1`, or start empty before the first
     publish.
  4. `python -m src.dispatch.run --site outputs/site/v1`, with the secrets as env.
  5. If `changed && !dry_run`: `scripts/site_release.sh upload outputs/site/v1`
     (validates first), then upload the same tree as an Actions artifact.
- **`deploy` job:** `needs: dispatch`, and runs only when `changed`.
  - It calls `pages.yml` as a reusable workflow. That needs `on: workflow_call` with an
    `artifact` input added to `pages.yml`.
  - The deploy then builds from this run's artifact instead of re-downloading the
    release. So it can't race the upload, and both jobs show in one run.
  - `gh workflow run pages.yml`, which the `pages.yml` header mentions, also works, but
    it splits the run in two.
- **Permissions:** `contents: write` (release upload), `pages: write`, `id-token: write`
  (deploy), `actions: read`.
- **Secrets and variables:**
  - secrets: `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_HTTP_PATH`
  - variable: `PROCESS_SESSION_JOB_ID`. Point it at the job deployed with the bundle's
    production target, not a `[dev …]` copy. Without it, the name lookup in `jobs.py`
    finds whichever copy exists.
  - The same values live in the local `.env` (gitignored). The token never goes into
    front-end code or the published JSON.
  - PAT expiry date: **2027-10-08 02:43 UTC** (token `f1-pred`, created 2026-10-08).
    Replace it before the 2027 season ends: create a new token, then
    `gh secret set DATABRICKS_TOKEN` and update `.env`.

Later, Monday training gets its own scheduled workflow (Phase 3).

### Dry run before going live

1. Run `workflow_dispatch` with `round=17`, `now=2026-10-11T16:00Z` (R17 race ready
   + 1 h) and `dry_run=true`. Every session is already processed or gets processed,
   the round publishes into the runner's tree, and the check passes, with no upload.
2. Seed the live site with a full R17. Jumping straight to stage R leaves the race
   predictions `error` ("No prediction was published before the session"), because no
   earlier snapshot exists. So build it stage by stage locally, then release it:
   `python -m src.dispatch.replay 2026 17`, `scripts/site_release.sh upload
   outputs/site/v1`, `gh workflow run pages.yml`. A `workflow_dispatch` run without
   `dry_run` at `now=2026-10-11T19:05Z` then exercises upload and deploy from the
   workflow (it republishes for the weather).
3. A scheduled run on a quiet day exits with `changed=false` in under ~2 min.
4. Thursday 2026-10-22 21:30 UTC (FP1 − 20 h) brings the first real `pre_weekend` build
   of R18. The R18 race is ready at 2026-10-25 23:00 UTC, and the window closes 24 h
   later.

### Fallback when Databricks is unavailable

Free Edition has no SLA and can stop compute for the day (see Known constraints), so
the race-weekend path must not depend on Databricks alone.

**This path does not work as written** (found 2026-10-13): `livetiming.formula1.com`
answers 403 to GitHub-hosted runners, so step 1 can't load FastF1 there. Locally and on
Databricks serverless it works. Phase 2b has to get session data onto the runner another
way, for example a self-hosted runner, or Databricks mirroring the raw `SessionTables`
Parquet to a Release asset after each ingest (useless when Databricks itself is down).

**Runner path.** When the Databricks job can't run, the dispatcher scores the session on
the GitHub runner with the same `src/` code:

1. FastF1 → `SessionTables`
2. the pandas functions (`laps`, `summaries`, `long_runs`, `features`)
3. score with each section's `champion`
4. publish → deploy

This works because the exploration modules are platform-agnostic, and no Spark-only step
is involved.

- **Trigger:** the job fails to start (quota, expired token, API error), fails, or runs
  past its timeout (30 min). The dispatcher falls back for that session and says so in
  the run summary and the failure email.
- **What the runner needs without Databricks**, mirrored to GitHub Release assets on
  every successful run:
  - the current `champion` of each section, exported from MLflow whenever the alias moves
  - a Parquet snapshot of the gold/feature history the features read (form, circuit
    history), refreshed after Monday training
  - the full published tree, which is already in place (Part 3)
- **Reconcile.** The runner can't write `ops.processed_sessions` while Databricks is
  down. It records the session in a fallback log in the release. The next healthy
  dispatcher run re-processes that session on Databricks. That run is idempotent and
  overwrites the fallback documents, so Delta stays complete.
- **Not covered:** Monday training and backfills are Databricks-only. If they can't run,
  the previous `champion` stays.
- **Cost of the fallback:** silver is Spark-native, so the runner path uses the pandas
  equivalents (`laps.py` filters, the exploration modules). The two can drift, so a
  parity check guards them (Phase 2b exit check).

### Known constraints

- GitHub cron can run 5–20 min late. That doesn't matter here.
- **GitHub-hosted runners can't reach F1 live timing** (`livetiming.formula1.com`
  answers 403; measured 2026-10-13). Jolpica and Open-Meteo work. So nothing on the
  runner may load FastF1 timing or telemetry: circuit geometry is committed, session
  data comes from the lakehouse. Open-Meteo's historical-forecast host also returned a
  504 once; only replays and the day after a race use it, and weather then goes `stale`.
- Free Edition allows **5 concurrent job tasks** per account. The dispatcher processes
  one session at a time, and a backfill must not fan out into parallel job runs. Spark's
  own parallelism inside a task (`mapInPandas`, `applyInPandas`) is unaffected.
- One SQL warehouse (2X-Small). Cold start measured at 26.7 s for the first query,
  2 s to connect.
- Over-quota serverless usage stops compute for the rest of the day, in extreme cases
  the month. Data and settings survive. The quota itself is not published. The
  race-weekend path is meant to fall back to the runner (see Fallback, which doesn't
  work as written yet).
- Personal access tokens expire. An expired token makes every dispatcher run fail until
  you notice the failure emails, so record the expiry date (Dispatcher → Secrets).
- Scheduled workflows in a public repo are disabled after 60 days without commits. Keep
  a monthly off-season heartbeat, or re-enable before the season.
- Failed runs email the repo owner. That is the monitoring for now.
- Manual intervention is needed only for a failed run that retries can't fix. Model
  selection is automatic; a bad switch is undone by moving the `champion` alias back.

## Layout

What exists, and what is still planned:

```
src/
  config.py, schema.py     paths and constants; the artifact contract
  sessions.py              weekend formats, stage order, SessionTables, session_window
  laps.py, results.py,     exploration modules, one per future table; pandas, no Spark,
  summaries.py,            reused by gold, publish and the runner fallback
  timeline.py,
  long_runs.py, features.py
  ingest/                  FastF1 session → SessionTables Parquet + meta.json
  etl/                     Spark bronze, silver, gold; ops (state table)
  models/                  baselines.py now; one module per section in Phase 3
  publish/                 lakehouse reads, reference data, documents, site (check + write)
  dispatch/                dispatcher, jobs (Databricks SDK), replay; run.py next
databricks/                Asset Bundle: databricks.yml, resources/*.yml, notebooks
scripts/                   site_release.sh (published tree ↔ Release), check_site.sh
web/                       front end, built and deployed to GitHub Pages
.github/workflows/         pages.yml; dispatch.yml next; weekly training in Phase 3
```

## Phases

Each phase has an exit check. Don't start the next one until it passes. Current status is
at the top of this document.

| # | phase | exit check |
|---|---|---|
| 0 | **Platform spike.** Connect to the workspace locally, create catalog/schema/volume, upload one Parquet file, run a FastF1 `session.load()` in a Databricks notebook, read a table back with the SQL connector, trigger a job from outside with a token. | Written answers on network, external triggers and quotas. **Passed 2026-10-08.** |
| 1 | **Lakehouse, one race.** Ingest one race, build bronze → silver → gold with Spark, add `ops.processed_sessions`. | Gold tables for that race; re-running produces identical tables. **Passed 2026-10-11** on 2026 R16. |
| 2 | **Replay.** Run the dispatcher against a past weekend on a fake clock, session by session, with baseline models and a real publish step. | A full round directory that passes `python -m src.schema check`, with no manual steps. **Passed 2026-10-11** on 2026 R15. |
| 2b | **Fallback path**, narrowed 2026-10-13. The published tree lives in a Release (done). Champions are exported to Release assets and scored without Spark (done inside Phase 3). Runner-side ingest is deferred. | A Databricks job failure leaves the site on the last complete stage and emails the owner; the next run recovers. Checked by the CI dry runs of 2026-10-13. |
| 3 | **Backfill + models** (Phase 3 plan). Backfill 2018 → now. Replace the baselines one section at a time, with MLflow tracking and a season-split backtest. Add the Monday champion check with shadow scoring. | Each model beats its baseline on the backtest. Calibration decided per model. |
| 3b | **Research swarm** (optional). Parallel agents in sandboxes propose and backtest model changes against the frozen harness. | A swarm-proposed change beats the champion on the backtest **and** on the untouched holdout season, and, once the owner merges it, is picked by the Monday check. |
| 4 | **Front end** (parallel from the start). Lovable design → `web/`, built against `docs/examples/v1/`, deployed to GitHub Pages, then pointed at real output. | Page renders every section status (`ready`, `stale`, `pending`, `error`, `not_applicable`). |
| 5 | **Go live.** Enable the schedule for the current season. | One real weekend published end to end with no manual step. |

### Phase 3 plan

Written 2026-10-13. The goal is the Phase 3 exit check: each model beats its baseline on
the backtest, calibration decided per model. Sections are replaced one at a time,
`finishing_order` first: it is the headline card, and the dashboard already grades it
against the result (vs Result).

**Calendar rule.** Databricks work for Phase 3 (backfill, training, backtests) runs on
Tuesday and Wednesday only. Thursday to Monday belongs to the dispatcher, and an
over-quota day would stop the live weekend.

Each step ends in its own check. Don't start the next step until it passes.

#### Step 1: backfill the lakehouse, 2018 → 2026 R17

- **Scope.** Every session in `get_sessions()` for 2018–2025 and 2026 R1–R17, about
  900 sessions. 2026 R15–R17 are already in. Live rounds from R18 on fill themselves.
- **Storage: all on Databricks, the same path as a live session.** Raw `SessionTables`
  Parquet goes to the Volume (`/Volumes/race_preds/raw/fastf1/<season>/<round>/<session>/`),
  then bronze → silver → gold Delta tables in the `race_preds` catalog. Nothing is
  written locally or to GitHub. The FastF1 cache stays on the job's local temp disk
  (SQLite does not work on a Volume), so one job run per round also shares that cache
  across the round's sessions. Size: a session is a few hundred KB of Parquet, so the
  whole backfill is a few hundred MB.
- **Order: newest first.** 2026, then 2025, 2024 and back. Each finished season is
  usable for training at once, and the recent seasons matter most under the 2026 rules.
- **One job run per round, not per session.** A `backfill_round` job loops over the
  round's sessions inside one serverless task, so each round pays one cold start instead
  of five. It records each session in `ops.processed_sessions` exactly like
  `process_session`, so the dispatcher's "missing from gold" logic covers it. Runs are
  sequential (5 concurrent tasks is the account limit).
- **Measure before scaling.** Time one round first, then size a Tuesday batch so it stays
  well inside the daily quota. Record the timing here.
- **Jolpica results.** `get_results(years, kind)` for race, sprint and qualifying,
  2018 → now, into `bronze.ergast_results`. The form and DNF features read it, and it
  gives the grid for 2021–22 sprint weekends.
- **Known gaps.** Sessions that fail to load are marked skipped (2020 R13 has no
  FP2/FP3). 2021 Belgium labels as 0 SC (Race incident labels).
- **Check:** every scheduled session has a terminal state in `ops.processed_sessions`
  (`succeeded` or skipped); per-season row counts of `gold.driver_session` and
  `gold.session` look right; re-running one backfilled round gives identical tables.

#### Step 2: the feature table

- **`gold.features`, one row per driver × round × stage.** A row only uses sessions
  allowed at its stage (`get_session_stage`) and rounds before its own. Built with Spark
  from gold and `bronze.ergast_results`; the per-session part reuses
  `weekend_features()` through `applyInPandas`.
- **Feature groups:**
  - session pace: the `FEATURE_COLS` of each session available at the stage
  - form: rolling finish and qualifying position over recent races, weighted to the
    latest, with the 2026 rounds weighted up (new regulations)
  - team: team-mate gap, team form
  - grid: the Ergast grid once the stage is past Q (never the Q position)
  - reliability: driver and team DNF rate
  - context: circuit history, `event_format`, practice sessions before Q, era flag
- **Labels on the same rows:** finishing position, classified or not, qualifying
  position.
- **Leakage test (the one test that must never be skipped).** For a sample of rows,
  rebuild the features from only the sessions allowed at the stage and only earlier
  rounds, and assert they equal the stored row.
- **Check:** the table covers every backfilled round × stage, and the leakage test
  passes.

#### Step 3: the evaluation harness (frozen once written)

- **Splits:**
  - season-split backtest: test seasons 2022, 2023, 2024, each trained on every
    earlier season
  - 2026 walk-forward: R6–R17, each round trained through the round before. This is
    the closest replay of live use, and it is where the 2026 rule change shows.
  - holdout: 2025, scored once per model just before it becomes a candidate, and never
    used to choose features or settings
- **Metrics,** fixed now, the same as the Monday check (Part 2): ranked probability
  score and log loss on `position_probs` for finishing order and qualifying; Brier score
  for race incidents; top-1 / top-2 hit for strategy. The readable numbers the dashboard
  shows (winner, podium and top-10 hits, mean rank error) are reported alongside but
  never select a model.
- **Pure pandas** (`src/models/evaluate.py`), reading a Parquet snapshot of
  `gold.features`. The same code runs locally, on Databricks and in a research-swarm
  sandbox (Phase 3b). On Databricks the backtest grid (model × split × stage) runs
  through `applyInPandas`.
- **Baselines first.** The harness scores the four baselines and logs them to MLflow.
  Those scores are the bar.
- **Check:** baseline scores for every section × stage × split in MLflow; the harness
  and splits are then read-only.

#### Step 4: `finishing_order` model

- **Shape:** a strength score per driver, a DNF probability per driver, then a Monte
  Carlo that turns both into `position_probs` and `p_dnf`.
  - strength: a regularised model of finishing position on the step 2 features (start
    linear, try gradient boosting only if the backtest says so)
  - DNF: logistic on reliability and circuit
  - simulation: sample retirements, then a Plackett–Luce order from the strengths. Its
    temperature is fitted on the backtest and is the calibration knob.
- **Check:** better ranked probability score than both baselines (grid order after Q,
  qualifying-based order before) on the season-split backtest and the 2026 walk-forward,
  at every stage.

#### Step 5: MLflow, champion export, scoring in publish

- Register `race_preds.models.finishing_order` in Unity Catalog, alias `champion`.
- On every alias change, export the champion to a Release asset (`models-v1`). Publish
  loads it from there and scores without Spark (Decisions, 2026-10-13). This is the part
  of Phase 2b that survives.
- `model.calibrated` turns `true` only after the backtest reliability curve supports it.
- **Check:** a replay of 2026 R17 publishes the champion's `finishing_order` with no
  manual step, and its `model` block names the registered version.

#### Step 6: the Monday check

- A `train.yml` workflow on Monday (after the race window closes) triggers a Databricks
  `train_models` job: grade the last round, compare on the rolling window, retrain,
  select (Part 2 → Weekly model check).
- Shadow scoring: publish scores every candidate and writes the non-champions to
  `ops.predictions_shadow` through the SQL warehouse.
- **Check:** one Monday run grades a round, logs the scores and leaves the alias where
  the rule says.

#### Step 7: the other sections

`qualifying` next (it shares the strength model), then `race_incidents` (a rate model,
cheap), then `strategy` (the degradation model, the hardest). Each goes through steps 4–5
with its own baseline as the bar.

**Target.** Steps 1–3 before R20; a `finishing_order` champion live for R21 or R22. The
off-season covers step 7.

## Phase records

### Phase 0 results

Everything measured on Free Edition, 2026-10-07/08.

| question | answer |
|---|---|
| Serverless outbound network | Yes. Jolpica, Open-Meteo and livetiming all reachable; `session.load(telemetry=False)` for 2025 R1 completed in a job. |
| External job trigger | Yes, both ways. CLI `bundle run`: 41 s for a job that pip-installs FastF1 and loads one session. SDK `jobs.run_now(...).result()`: 32 s. The dispatcher uses the SDK. |
| Own catalog | Allowed. `race_preds` catalog, `raw` schema, `fastf1` Volume created with plain SQL. |
| Volume upload from outside | Works with `databricks fs cp`. One race's laps ≈ 88 KB as Parquet. |
| Local read with SQL connector | Works. Needs host, PAT and the warehouse HTTP path from `.env`. |
| Concurrent job tasks | 5 per account. |
| SQL warehouse | One, 2X-Small. |
| Model Serving | Available, CPU only, limited endpoint count, no batch inference. Not needed by the plan. |
| Vector Search | One endpoint, one search unit. Not needed by the plan. |
| Account level | No account console, no account APIs, one workspace. Everything is workspace-level; a workspace PAT is all GitHub Actions needs. |
| Serverless quota | Not published. Over-use stops compute for the day. |

Spike assets:

- `databricks/` holds the Asset Bundle: `databricks.yml` from the `default-python`
  template, catalog `race_preds`, no personal schemas.
- The `spike` job and its network-check notebook are there too.
- The bundle's `dev` target prefixes job names with `[dev <user>]`.

### Phase 1 record

Built on 2026 R16 (Bahrain, conventional, 22 cars). The bundle job `process_session`
(parameters season / round / session_id) runs one task per layer. Ingest passes its
output directory to the next task as a task value.

- **Ingest, done 2026-10-08.** `src/ingest/fastf1_session.py` writes the raw layer in
  about 30 s on serverless.
  - The SQL warehouse reads all six tables with the expected types (durations `double`,
    `Deleted` `boolean`, UTC timestamps `timestamp_ntz`).
  - A re-pull writes byte-identical Parquet.
  - A session that has not run, or does not exist in that weekend, raises
    `SessionNotAvailable` and writes nothing.
  - FastF1 leaves some race control columns (`Lap`, `Status`, `RacingNumber`, `Sector`)
    all-None in most sessions. Parquet stores those as the null type, which Delta
    rejects. Ingest writes them with fixed types (`FIXED_TYPES`) and fails loudly on any
    other all-empty column. 25 sessions across five weekends then share one schema per
    table.
- **Bronze, done 2026-10-11.** `src/etl/bronze.py`, Spark only. Ingest + bronze take
  about 2 min per session. Checked on R and FP1:
  - row counts equal the Volume files
  - re-running R gives zero differing rows (`EXCEPT ALL` both ways on Delta time travel,
    `pulled_at` excluded)
  - writing FP1 leaves every R row unchanged
- **Silver, done 2026-10-11.** `src/etl/silver.py`, the third task of the job, about
  30 s. Checked on R and FP1 against the pandas code:
  - `is_clean` and `is_quick` select exactly the laps of `src/laps.py`
  - per-driver `clean_lap_median` from silver equals `summarize_session`
  - `stint_lap` runs 1..n in every stint, and there are no null ids
  - re-running R gives zero differing rows
- **Gold and the state table, done 2026-10-11.** `src/etl/gold.py` is the fourth task,
  and `src/etl/ops.py` records every task in `ops.processed_sessions`. A full session
  (ingest → bronze → silver → gold) takes about 2–4 min.
  - Bronze gained a `sessions` table, which `summarize_session` needs.
  - Two type fixes came out of it. `summarize_session` now fills `clean_laps` with 0
    like the other counts (it was float whenever one driver had no clean lap, int
    otherwise, and Delta refuses to merge the two). `long_runs` returns typed columns
    even when empty.
- **Exit check passed 2026-10-11.**
  - All five Bahrain sessions processed.
  - Every gold table equals the pandas functions run locally on the same session,
    column by column.
  - A full re-run of R left the R rows of all twelve bronze, silver and gold tables
    identical (`pulled_at` excluded).
  - All 20 session × stage rows in the state table are `succeeded`.

### Phase 2 record

What was built: the dispatcher and replay (Automation → Dispatcher), `src/publish/` and
`src/models/baselines.py`. `publish/` is made of:

- `lakehouse.py`: SQL warehouse reads, limited to the sessions usable at the stage
- `reference.py`: FastF1 field, Ergast standings and history, Open-Meteo, circuit
  geometry
- `documents.py`: one builder per section
- `site.py`: manifest, index, stale / error fallback, and a staging copy checked with
  `check_round` before it replaces the published round

Exit check, passed 2026-10-11:

- `python -m src.dispatch.replay 2026 15` cleared the round, triggered the job for all
  five Baku sessions (none were in the lakehouse), and published six stages.
- The round passes `python -m src.schema check`, and the state table has 20 `succeeded`
  rows.
- 2026 R16 replays as well (no jobs, already processed).
- A forced model failure keeps the last snapshot as `stale`, and a section that never
  succeeded publishes `error`. Both pass the check.

Decisions and known gaps:

- **The field** is the latest session run this weekend except FP1 (rookies stand in
  there), before that the previous round's race.
  - The first replay stopped at Q because R14 → R15 swapped Tsunoda for Hadjar, and the
    check rejected an unknown driver id.
  - A `pre_weekend` or FP1 snapshot can still name last round's driver.
  - A season opener has no previous round and fails.
- **Race laps** are the most common winner's lap count of the last three races at the
  circuit. Only a new circuit falls back to 305 km over the lap length measured by
  telemetry, which reads a little short (Baku 52 instead of 51).
- **Circuit geometry** is reference data. It is built once from any FastF1 session at the
  circuit with telemetry (this event first, then three seasons back) and committed as
  `reference/circuits/<id>.json`, because the GitHub runner gets 403 from F1 live timing.
  Every 2026 circuit is there (R18–R23 from their 2025 sessions); a new circuit has to be
  built locally and committed before its Thursday build.
- **Weather** for a past date comes from Open-Meteo's historical-forecast API, which
  archives the forecast, so a replay does not see the observed weather. `issued_at` is
  left empty.
- **Race strategies** leave out a driver with a stint FastF1 has no compound for (4 of 22
  on 2026 R16) rather than inventing one.
- Phase 2 left the scheduled workflow open. It is Next up 1.

## Backlog

Ideas deliberately left out of the phases above.

- **Animated flag map.** A circuit map whose marshal sectors light up yellow / red as the
  session plays back minute by minute, with SC / VSC and race control messages alongside.
  - Already exists: `session_timeline()` in `src/timeline.py`, one row per minute with
    track status, session status, cars on track and race control messages. The circuit
    outline and corners are already published in `event.json`.
  - Still needed:
    1. Parse sector-scoped flags from race control (`Scope == "Sector"`, the `Sector`
       column, `"YELLOW IN TRACK SECTOR 3"` / `"CLEAR IN TRACK SECTOR 3"`). Turn them into
       an active-flag set per sector per minute.
    2. Add marshal sectors to the circuit geometry (`get_circuit_info()`). Marshal
       sectors are marker points, not segments, so assign outline points to sectors by
       distance along the lap.
    3. Publish a new document type for it. That means an edit to `src/schema.py` and
       `docs/artifact-schema.md`, then re-exporting the schema, the examples and the
       front-end types.
    4. Animate it in the front end.
  - Without telemetry the timeline aligns race control messages (UTC) through the
    chequered flag. That was within ~2 s of the telemetry anchor on 2025 sessions. The
    scheduled start is only a last resort: races were 3–18 min off with it.
- **Front-end polish:**
  - Movers labels overlap for drivers with close expected positions.
  - The JS bundle is 784 KB, mostly Recharts.
  - The example round has only FP1 and FP2 snapshots; extend
    `docs/examples/make_examples.py` to exercise more stages.

## Open questions

- Data source for the Pirelli tyre allocation (not in FastF1).
- Research swarm sandbox runtime: GitHub Actions matrix, containers or local worktrees.
