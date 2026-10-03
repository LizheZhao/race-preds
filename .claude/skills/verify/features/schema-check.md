# Round validation CLI

`python -m src.schema check <round_dir>` validates one published round directory:
every document against its pydantic model, then cross-file invariants (`check_round`
in `src/schema.py`).

## Sub-features

- Per-document validation: a malformed file reports `N validation error(s)`.
- Manifest consistency: listed section files exist, file stage matches manifest stage,
  history snapshots exist, season/round match.
- Cross-document ids: predicted field equals the `event.json` entry list; `facts` and
  `results` only reference known driver and team ids; `strategy.race_laps` equals
  `event.circuit.race_laps`.
- Exit code: 0 when clean, 1 when any problem is printed.

## How to get to it (user POV)

The owner (and later the publish step and CI) runs it on a round directory before
publishing JSON for the front end. The committed fixture is `docs/examples/v1/2025/16`
(Monza, snapshot after FP2, synthetic data).

## Driving it with the shell

```bash
# happy path
python -m src.schema check docs/examples/v1/2025/16 > "$EV/schema-check-ok.txt" 2>&1; echo "exit=$?" >> "$EV/schema-check-ok.txt"; cat "$EV/schema-check-ok.txt"

# failure path 1: missing manifest
python -m src.schema check "$SCRATCH/nope" > "$EV/schema-check-missing.txt" 2>&1; echo "exit=$?" >> "$EV/schema-check-missing.txt"; cat "$EV/schema-check-missing.txt"

# failure path 2: cross-file break in a scratch copy (never edit the committed fixture)
cp -R docs/examples/v1/2025/16 "$SCRATCH/round"
python - "$SCRATCH/round" <<'EOF'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1]) / "facts.json"
d = json.loads(p.read_text()); d["facts"][0]["driver_ids"] = ["not_a_driver"]; p.write_text(json.dumps(d))
EOF
python -m src.schema check "$SCRATCH/round" > "$EV/schema-check-broken.txt" 2>&1; echo "exit=$?" >> "$EV/schema-check-broken.txt"; cat "$EV/schema-check-broken.txt"
```

Observable end state:

- happy path prints `docs/examples/v1/2025/16: OK`, exit 0
- missing dir prints `✗ manifest.json: listed in manifest but missing` then `1 problem(s)`, exit 1
- broken copy prints `✗ facts: '<fact id>' references ids outside the entry list` then `1 problem(s)`, exit 1

All three together are the proof; the happy path alone cannot show the check can fail.
When you change a validator or invariant, add a scratch-copy break that targets exactly
that rule and show it is caught.

## Gotchas

- Computed fields (`p_win`, `p_podium`, `stops`, ...) are stripped and re-derived on read,
  so editing them in a scratch copy has no effect. Break a stored field instead.
- A bare `check` of a nonexistent path reports the manifest message, not "directory not found".
- Run from the repo root; `python -m src.schema` fails from `nb/`.
