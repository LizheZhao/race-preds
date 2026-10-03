# Schema + example regeneration

After any edit to `src/schema.py`, the JSON Schemas in `docs/schema/` and the fixture in
`docs/examples/v1/` must be regenerated, or the front end's types go stale
(`CLAUDE.md`). This feature proves they are in sync.

## Sub-features

- `python -m src.schema export <dir>` writes ten `<artifact>.schema.json` files
  (serialization mode, so computed fields appear).
- `python docs/examples/make_examples.py` rewrites `docs/examples/v1` (synthetic Monza
  R16 fixture, seeded RNG, fixed `generated_at`, so output is deterministic).
- The regenerated round must pass `check`.

## How to get to it (user POV)

The owner edits `src/schema.py`, then runs the two regeneration commands from
`CLAUDE.md`, then `check`. Verification replays that in a scratch copy and compares to
what is committed.

## Driving it with the shell

`make_examples.py` resolves `ROOT` from its own path and overwrites in place, and
`docs/` is untracked so `git diff` shows nothing. Replay in `$SCRATCH` and `diff -r`:

```bash
mkdir -p "$SCRATCH/docs/examples" && cp -R src "$SCRATCH/src" && cp docs/examples/make_examples.py "$SCRATCH/docs/examples/"
( cd "$SCRATCH" \
  && python docs/examples/make_examples.py \
  && python -m src.schema export schema_out \
  && python -m src.schema check docs/examples/v1/2025/16 ) 2>&1 | tee "$EV/schema-regen.txt"

diff -r "$SCRATCH/docs/examples/v1" docs/examples/v1 && echo EXAMPLES_IDENTICAL | tee -a "$EV/schema-regen.txt"
diff -r "$SCRATCH/schema_out" docs/schema           && echo SCHEMA_IDENTICAL   | tee -a "$EV/schema-regen.txt"
```

Observable end state: `examples written to ...`, ten `wrote schema_out/*.schema.json`
lines, `...: OK`, then `EXAMPLES_IDENTICAL` and `SCHEMA_IDENTICAL`.

- If you changed `src/schema.py` on purpose, a `diff` is expected and is the proof the
  change reached the outputs. Capture the diff into `$EV` and tell the owner the committed
  copies need regenerating; do not regenerate them yourself.
- If you changed nothing in the schema and a diff appears, the committed outputs are
  already stale: report it.

## Gotchas

- Never run `make_examples.py` or `export` against the repo itself during verification;
  it overwrites the owner's files.
- `__pycache__` is created in `$SCRATCH/src`; it is removed with the scratch dir.
- The fixture is synthetic by design, so do not treat its probabilities as model output.
