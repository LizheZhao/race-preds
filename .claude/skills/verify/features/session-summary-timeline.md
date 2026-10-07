# Session summary + timeline

`src/summaries.py` and `src/timeline.py` turn one loaded FastF1 session into feature
tables: `summarize_session` (per-driver and per-session rows) and `session_timeline` (one
row per minute). Both use `session_window` from `src/sessions.py`. These feed the stage-safe weekend feature table in notebook section 13.

## Sub-features

- `summarize_session(session) -> (by_driver, session_row)`: laps, pace, tyres, race
  control counts per driver; window, weather, track status, race control per session.
- `session_timeline(session, freq="1min")`: weather, track status flags (`is_yellow`,
  `is_sc`, `is_red`, `is_vsc`), `cars_on_track`, `max_laps_completed`, race control messages.
- Season results (`src/results.py`): `get_season_results` / `get_results` (Ergast via jolpica; needs network,
  rate limited; verify only if you changed them).

## How to get to it (user POV)

Notebook sections 10 to 14 call these on sessions loaded with laps, weather and messages.
Verification calls the same public functions on a cached session.

## Driving it with the shell

```bash
python - <<'EOF' 2>&1 | tee "$EV/session-summary-timeline.txt"
import fastf1
from src.config import enable_cache
enable_cache()
from src.summaries import summarize_session
from src.timeline import session_timeline

s = fastf1.get_session(2025, 16, "R")                  # Monza race, cached
s.load(laps=True, telemetry=False, weather=True, messages=True)
by_driver, row = summarize_session(s)
tl = session_timeline(s)
print("by_driver", by_driver.shape, "session_row", row.shape, "timeline", tl.shape)
print(by_driver[["Driver", "DriverId"]].head(3).to_string(index=False))
print(row.iloc[0][["season", "round", "session", "event_format", "duration_min"]].to_dict())
print(tl[["minute", "cars_on_track", "max_laps_completed"]].max().to_dict())

# the guard: messages=False must refuse
s2 = fastf1.get_session(2025, 16, "R")
s2.load(laps=True, telemetry=False, weather=True, messages=False)
try: summarize_session(s2)
except ValueError as e: print("ValueError:", e)
EOF
```

Observable end state (Monza 2025 race):

- `by_driver (20, 33) session_row (1, 26) timeline (74, 20)` (shapes move if you add columns; changed counts need an explanation)
- first rows `ALB albon`, `ALO alonso`, `ANT antonelli`
- `session_row`: `season 2025`, `round 16`, `session Race`, `event_format conventional`, `duration_min` about 73.4
- timeline maxima: `minute 73`, `cars_on_track 19`, `max_laps_completed 52`
- the guard prints `ValueError: load the session with messages=True ...`

For a sprint-format change also run it on a 2025 sprint session (`"S"`, `"SQ"`):
`DriverId` is empty for sprint qualifying and must come back as NaN, not `""`.

## Gotchas

- First load of an uncached session downloads tens of MB and can be slow or rate limited.
  Prefer sessions listed under `data/fastf1_cache/`. Never pass `telemetry=True` here.
- 2026 has 22 cars; `drivers_n` and shapes must not assume 20.
- Do not infer DRS usage for 2026 (DRS no longer exists).
