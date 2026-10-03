# Artifact schema v1

The dashboard is a static front end reading JSON files that a Python pipeline writes on
a Thu–Sun schedule. There is no application server. These files are the entire interface
between the two halves, so they are specified precisely:

- **`src/schema.py`**: pydantic models. This is the source of truth, and the pipeline
  validates against it before publishing.
- **`docs/schema/*.schema.json`**: JSON Schema exported from those models, used to
  generate front-end types (e.g. `json-schema-to-typescript`).
- **`docs/examples/v1/`**: one complete synthetic round (Italian GP 2025, snapshot after
  FP2) to build the front end against before the pipeline exists. The probabilities,
  forecasts and history in it are made up.

## How the front end reads it

Three hops, each small:

```
v1/index.json                    → which round is current
v1/2026/16/manifest.json         → status of every panel for that round
v1/2026/16/<section>.json        → the panel's data (fetched in parallel)
```

Only `index.json` has a fixed URL. Everything else is reached by following paths, so the
layout below can change without touching front-end code.

## Layout

```
v1/
  index.json                         season index, current_round pointer
  2026/16/
    manifest.json                    one status entry per section, always all eight
    event.json                       circuit, sessions, teams, drivers, standings
    weather.json                     forecast + observed + climatology
    facts.json
    results.json                     actuals, filled in as sessions complete
    finishing_order/<stage>.json     ┐
    qualifying/<stage>.json          │ one snapshot per stage, e.g. FP1.json, FP2.json, Q.json
    race_incidents/<stage>.json      │
    strategy/<stage>.json            ┘
```

Prediction sections keep **one file per stage** instead of overwriting. That costs little
(a round is ~14 KB gzipped) and provides two things:

1. **Movers.** "Norris up 4% since FP1" needs the previous snapshot. The manifest lists
   the available ones in `history`.
2. **Grading.** Once `results.json` has the race, each stage's snapshot can be scored
   against the outcome. That is how you learn whether Friday predictions are worth
   publishing, and it gives the dashboard a track-record panel later.

## Stages and the weekend lifecycle

`stage` is the last session whose data the pipeline has ingested, using FastF1 session
ids. Order depends on the format:

| format | stages |
|---|---|
| `conventional` | `pre_weekend` → `FP1` → `FP2` → `FP3` → `Q` → `R` |
| `sprint_qualifying` | `pre_weekend` → `FP1` → `SQ` → `S` → `Q` → `R` |

What a conventional weekend publishes:

| when | stage | new or updated |
|---|---|---|
| Thu | `pre_weekend` | event, weather, facts, all four predictions (priors only: form, circuit history) |
| Fri after FP1/FP2 | `FP1`, `FP2` | predictions re-run with practice pace; strategy gets its first real degradation curves |
| Sat after FP3 | `FP3` | predictions |
| Sat after Q | `Q` | results (qualifying); finishing_order now has `grid_position`; qualifying section goes to history |
| Sun after R | `R` | results (race, incidents, strategies used) |
| every few hours | unchanged | weather (forecasts move on their own clock, not with sessions) |

Every stage is optional. If FP3 is rained out, the pipeline skips from `FP2` to `Q`.

## Section status

The manifest always lists all eight sections, so the front end never has to infer a
missing panel:

| status | has data | front end shows |
|---|---|---|
| `ready` | yes | the panel |
| `stale` | yes, last good version | the panel plus `message` as a warning |
| `pending` | no | "Available after `available_from`", e.g. results before Q |
| `error` | no | `message`, and no fallback exists |
| `not_applicable` | no | nothing, e.g. a sprint panel on a conventional weekend |

`stale` exists so a failed refresh degrades gracefully. When the pipeline fails after
FP2, the FP1 prediction stays up with a warning and the panel isn't blanked. The pipeline
has to preserve the previous path when it writes `stale`.

## Decisions worth knowing

**Probabilities are fractions, and they carry a `calibrated` flag.** Every prediction
document has `model.calibrated`. It becomes `true` only after the backtest shows the
probabilities match observed frequencies (reliability curve). While it is `false`, the
front end must present the numbers as relative model scores. This keeps the demo
dashboard's "model score, not a chance of winning" honesty, but as a data field that each
model can switch off once it has earned it.

**Full distributions, not just point predictions.** `finishing_order` stores
`position_probs` per driver (P1…Pn) plus `p_dnf`. P(win), P(podium), P(points) and
expected position are derived from it and written as computed fields. The front end gets
the convenient numbers, and a position heatmap is still possible. At 22 × 22 floats the
size is irrelevant.

**Invariants are enforced where they're cheap.** Row sums equal 1, each finishing
position is filled at most once (column sums ≤ 1), E[#SC] ≥ P(≥1 SC), stints are
contiguous and cover the race, a dry strategy uses two compounds, and sprint weekends
have no FP2/FP3. These catch real pipeline bugs (off-by-one indexing, percent vs.
fraction, a Monte Carlo that double-counts) before they reach the page.
`python -m src.schema check` adds the cross-file checks: driver ids that aren't in the
entry list, missing history snapshots, and a manifest that disagrees with the file it
points at.

**Ergast ids are the join key.** Drivers and teams are referenced everywhere by Ergast
`driverId` / `constructorId`. FastF1 exposes the same ids as `DriverId` / `TeamId` in
`Session.results`, so no mapping table is needed. Names, numbers and colours appear only
in `event.json`.

**The pipeline does the geometry.** The track outline and corners arrive already rotated
and scaled into the unit square. The front end draws an SVG path and does no math.

## Versioning

- The major version is in the path (`v1/`). A breaking change ships as `v2/` next to
  `v1/`, so an old front end keeps working until it is updated.
- `meta.schema_version` is semver. Additive changes (new optional fields, new sections)
  are minor bumps and stay in `v1/`. **The front end must ignore unknown fields.** The
  pipeline side is strict (`extra="forbid"`), but the reader must not be.

## Hosting

The files are plain static JSON, so any static host works: GitHub Pages, Cloudflare R2
or Pages, Vercel. `index.json` and `manifest.json` change on every run, so give them a
short cache TTL (≤ 60 s). Everything else can be cached for a few minutes, because a
changed snapshot always shows up through a new manifest.

## Not in v1

- **Scenario Lab / what-if.** Rescoring on demand needs either a scoring endpoint or a
  model that runs in the browser. Add it once the models are stable.
- **Per-driver strategy predictions.** v1 has race-level strategy options only.
  `results.race_strategies` records what each driver actually did.
- **Live in-session updates.** The pipeline runs after sessions, not during them.
- **A dedicated evaluation document.** Grading snapshots against results will become
  its own section once there's a season of snapshots to grade.

## Commands

```bash
python -m src.schema export docs/schema            # regenerate JSON Schema after editing src/schema.py
python docs/examples/make_examples.py              # regenerate the example round
python -m src.schema check docs/examples/v1/2025/16  # validate a round directory (exit 1 on problems)
```
