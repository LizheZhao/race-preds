# Dashboard data needs

What each part of the redesigned dashboard (tag `dashboard-review-v1`, 2026-10-15) reads,
whether the lakehouse already has it, and the work needed where it doesn't. Checked against
the replays of 2026 R16 (Bahrain GP at Sepang, conventional) and R17 (Singapore, sprint).

Kinds of work:

- **Ready.** Published today.
- **Publish change.** The data is in the lakehouse or a reference source; publish only has
  to put it in a document.
- **New aggregation.** A new gold table or `src/` function over tables we already ingest.
- **New ingest.** The lakehouse doesn't hold the data at all.
- **Curated.** Hand-kept reference files under `reference/`, every claim with a source.
- **Model.** A model to train or replace.
- **Ops.** Running something that already exists: backfill, deploy, register.

## Lakehouse coverage first

`gold.session` holds 2024 (10 races), 2025 and 2026. `silver.laps` holds 2024 (11 rounds),
2025 and 2026. The Phase 3 step 1 backfill to 2018 hasn't finished. Every "history at this
circuit" item below (incident history, speed-trap record, climatology, apex history) and
model training are limited to that window until it does. Singapore's circuit history shows
only 2024 and 2025 for this reason.

## By card

### Predicted finishing order

| Item | Source now | Status | Work |
|---|---|---|---|
| Position probabilities (heatmap) | `strength-pl` bundle, local only; live site uses `grid-order` | Ops | `python -m src.models.registry train finishing_order`, export the champion, upload the `models` release |
| Prediction trend: Sprint Quali, Sprint, Qualifying columns | baselines (`quali-season-average`, `sprint-grid-order`, `quali-sprint-order`) | Model | A qualifying model on `gold.features` (`y_quali` exists), reused for sprint qualifying. A sprint model needs a sprint label in `gold.features` (only `y_finish` for the race today) |
| Session results trend: Sprint Quali column | the sprint grid stands in for the SQ classification | Publish change | Add `results.sprint_qualifying` from `silver.results` (SQ rows exist; publish already reads them for the grid) |
| Driver card | event, results, standings, race strategies | Ready | Team logos need licensed assets; headshots are published (`headshot_url`) but not shown |

### Tyre strategy

| Item | Source now | Status | Work |
|---|---|---|---|
| Plans and pit windows | tyre prior in `baselines.py` | Model | Strategy model (Phase 3 step 7) |
| Degradation curve | the same prior, now curved | New aggregation | Lap delta vs tyre age per compound from `silver.laps` (`compound`, `tyre_life`, `lap_time_fuel_corr_s`, `is_clean`, `is_green`): this weekend's practice long runs plus earlier races here. `gold.stints` only has one linear slope per stint |
| Pit loss | constant 22 s | New aggregation | Per circuit from `silver.laps`: in-lap plus out-lap against the driver's median clean lap, earlier races here |
| Pirelli C-numbers | `reference/tyres/2026.json`, R1–R20 | Curated | Add R21–R23 when Pirelli announces them, about ten days before each race |

### Safety car and red flag

| Item | Source now | Status | Work |
|---|---|---|---|
| SC, VSC and red flag probabilities | league rates from `gold.session` | Model | Incident model (Phase 3 step 7) |
| Safety car by lap window | the race probability spread evenly over laps | New aggregation | Neutralisation periods per race (kind, start lap, end lap) from the per-lap `has_sc` / `has_vsc` / `has_red` flags in `silver.laps`; then fit the hazard by lap |
| Circuit history | `gold.session` rows at this circuit | Ops | Finish the backfill |
| Actual outcome | `results.race_incidents` | Ready | |

### Race pace and strategies

| Item | Source now | Status | Work |
|---|---|---|---|
| Lap-time box plots | `results.race_pace` from `silver.laps` | Publish change | Carry the compound per lap, or keep dry laps only. Bahrain's boxes are wide because intermediate and dry laps are mixed |
| Tyre stints | `results.race_strategies` | Ready | |

### Weather

| Item | Source now | Status | Work |
|---|---|---|---|
| Hourly air temperature and rain chance | Open-Meteo | Ready | |
| Track temperature min–max | `gold.session` | Ops | Deploy the bundle and rebuild gold. The fix that drops 0 °C sensor readings is in `summaries.py`, but R17 FP1 and SQ still have the old rows, so their minimum is missing |
| Climatology (wet race share, typical temperatures) | schema field exists, always null | New aggregation | From `gold.session` rows of earlier races here; depth depends on the backfill |
| Wet laps | `rain_frac` from FastF1's rainfall flag | New aggregation | The flag missed Bahrain's damp start (drivers ran intermediates). Add the share of laps on INTERMEDIATE or WET from `silver.laps` |

### Circuit

| Item | Source now | Status | Work |
|---|---|---|---|
| Map and corner positions | `reference/circuits/<id>.json` from FastF1 circuit info | Curated | Sepang has no corners in FastF1, so its map has nothing to click. Enter corner positions by hand or from another source |
| Corner names | `reference/stories/` | Curated | Marina Bay and Sepang only. The other calendar circuits still need researching |
| Apex speed and gear per corner, this race and earlier years | nothing | New ingest | See "Telemetry" below |
| Top speed this weekend | `silver.laps.speed_st_kph` | Ready | |
| Speed-trap record here | the same | Ops | Depth depends on the backfill |

### Circuit story and fun facts

| Item | Source now | Status | Work |
|---|---|---|---|
| Past winners, most wins, pole conversion | Ergast | Ready | |
| Designer and notable moments | `reference/stories/` | Curated | Two of 23 circuits so far |

### Results and championship

| Item | Source now | Status | Work |
|---|---|---|---|
| Race, sprint and qualifying classifications | `silver.results` | Ready | |
| Sprint qualifying tab | not published | Publish change | Same as `results.sprint_qualifying` above |
| Standings | Ergast, after the previous round | Publish change | At stage R, fetch the standings after this round once Ergast has them, falling back to the previous round |

## Telemetry

The pipeline doesn't load car telemetry. `ingest_session` calls
`session.load(telemetry=False)`, a decision recorded in `pipeline-plan.md` ("Telemetry stays
out until the lap-level pipeline works end to end"). The only telemetry ever loaded is the
one-off circuit geometry, built locally and committed, because GitHub runners get 403 from
F1 live timing. Corner apex speeds are the first dashboard feature that needs it.

Proposed shape, for review before building:

1. **Ingest** (Databricks, which can reach live timing per Phase 0) loads telemetry for Q,
   SQ and R only. For each driver's fastest lap it keeps the minimum speed and the gear at
   that point in a window around each corner, using the corner distances from FastF1's
   circuit info. It writes that small table, never the raw car data.
2. **Gold** gets `gold.corner_speeds` (season, round, session, driver, corner, apex speed,
   gear).
3. **Publish** puts, on each corner of `event.circuit.corners`: this weekend's pole-lap
   apex, the fastest apex anyone carried, and the pole-lap apex in earlier years here on
   the same layout. Marina Bay before 2023 is a different layout.
### Measured cost (2026-10-15)

Singapore 2026 (R17), loaded from an empty FastF1 cache, as a job would see it. Sizes are
FastF1's cache on disk, not network bytes; times include the download, on a laptop.

| Session | Laps only | Telemetry added | Car / position rows | In memory |
|---|---|---|---|---|
| Qualifying | 3 s, 1.6 MB | 5 s, 51 MB | 378k / 388k | 111 MB |
| Race | 5 s, 8.3 MB | 9 s, 109 MB | 800k / 801k | 231 MB |

Telemetry is about 15–30 times the lap data. The kept output, each driver's fastest lap
at each of 19 corners, is about 400 rows per session and takes under a second to compute.

- **Per weekend** (Q and R, plus SQ on a sprint weekend): about 160–210 MB downloaded and
  15–25 s of loading, discarded after the apex table is written.
- **Backfill 2018–2025** (about 190 rounds): roughly 30 GB downloaded once and about an hour
  of loading in total. It can run inside the existing `backfill_round` job, which takes
  about half a minute per round today.
- **Storing raw telemetry:** about 2.4M rows per weekend, a few GB for the backfill even
  compressed. The dashboard doesn't need it.

Verdict: worth loading for a derived per-corner table at ingest, not worth storing raw. The
download and memory are small for a serverless job. The real costs are the engineering
(ingest, bronze/silver/gold, publish) and the coverage: circuits without corner data in
FastF1, such as Sepang, get no apex numbers. No model needs telemetry yet, so this is a
dashboard feature, not a model input.

### What else telemetry gives

Checked on Singapore 2026 (R17). Channels: speed, RPM, gear, throttle, brake, DRS, X/Y/Z
position, and the gap to the car ahead.

| Use | Singapore 2026 | Verdict |
|---|---|---|
| Circuit character fact cards, from the pole lap | 46% of the lap at full throttle, 24% on the brakes, 12 braking zones (the biggest stop sheds 195 km/h before T14), 58 gear changes, 63–308 km/h, 5.3 m of elevation change | Worth it. One lap per weekend, same ingest pass as the apex table |
| Team corner profile: apex speed against the field median in slow (<120 km/h) and fast (≥180 km/h) corners | McLaren +3.7 slow / +4.2 fast km/h; Cadillac and Williams weakest | Promising model feature (car type × circuit type), but noisy from one lap per driver: Aston Martin's −14.5 in fast corners comes from 4 corners and 2 laps. Needs several sessions and the backfill before it is trusted |
| DRS / active aero | the DRS channel is 0 on every sample in 2026 | Not available. Active aero isn't in FastF1 telemetry |
| 2026 energy "clipping" (speed falling at full throttle before the braking point) | a first detector found none in 1,102 race laps | Unproven. The detector wasn't validated, so this says nothing yet |
| Gap to the car ahead (`DistanceToDriverAhead`) | not analysed | Possible later: following and overtaking analysis, heavier to compute |

## Suggested order

1. **Ops:** finish the backfill, deploy and rebuild gold, register the `strength-pl`
   champion. These unblock the most items and need no new code.
2. **Publish changes:** `results.sprint_qualifying`, standings after the race, compound on
   race-pace laps.
3. **New aggregations:** neutralisation periods, the degradation curve, pit loss, climatology
   and wet share.
4. **Curated:** stories and corner names for the remaining circuits, Sepang corners, and the
   R21–R23 allocations.
5. **New ingest:** telemetry and `gold.corner_speeds`.
6. **Models:** qualifying and sprint, incidents, strategy.
