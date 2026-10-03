# Weekend session layout

`src/session.py` maps an event's `Session1..5` names to short ids (`FP1 FP2 FP3 Q SQ S R`)
and answers "which sessions have happened by stage X". It is the basis for
`src/sessions.py` in `docs/pipeline-plan.md`, so conventional and sprint weekends must
both work. Never key off `Session4 == "Qualifying"`.

## Sub-features

- `get_sessions(year, rnd)`: list of `{session_id, session_name, session_dt, session_dt_utc}` in running order.
- `get_session_stage(year, rnd, stage)`: stage ids up to and including `stage`;
  raises `ValueError` if the weekend has no such session.
- `load_weekend(year, rnd)`: loads every session without telemetry (expensive; skip in verification unless you changed it).

## How to get to it (user POV)

Called from notebooks and, later, the dispatcher with a season and round from the
schedule. Cached schedules make it offline.

## Driving it with the shell

```bash
python - <<'EOF' 2>&1 | tee "$EV/session-layout.txt"
from src.config import enable_cache
enable_cache()
from src.session import get_sessions, get_session_stage
print([s["session_id"] for s in get_sessions(2025, 16)])      # conventional: Monza
print(get_session_stage(2025, 16, "FP2"))
print(get_session_stage(2025, 13, "Q"))                       # sprint weekend, pick one in the 2025 sprint list
try:
    get_session_stage(2025, 16, "S")                           # no sprint at Monza
except ValueError as e:
    print("ValueError:", e)
EOF
```

Observable end state:

- `['FP1', 'FP2', 'FP3', 'Q', 'R']`
- `['FP1', 'FP2']`
- `['FP1', 'SQ', 'S', 'Q']` for round 13 (Belgian GP, a sprint weekend; the stage list is cut at `Q`)
- `ValueError: stage S not occurred in 2025 race round 16, valid stages: [...]`

The point of the sprint line is that order differs from the conventional weekend. For a
change to the format tables, also drive a 2026 sprint round and a 2023 sprint-shootout
round (find them in `fastf1.get_event_schedule(year)["EventFormat"]`; they are not
exercised by the checks above) and compare against `fastf1.get_event(...)["Session1..5"]`.

## Gotchas

- Without `enable_cache()` FastF1 warns `DEFAULT CACHE ENABLED` and uses
  `~/Library/Caches/fastf1`: the run may then touch the network.
- The "valid stages" text in the `ValueError` lists stages that came before the missing
  one, not every stage of the weekend; don't use it to judge correctness.
- `SESSION_IDS` maps both "Sprint Shootout" and "Sprint Qualifying" to `SQ`.
