---
name: verify
description: Prove changes to race-preds work. There is no running app yet (no server, no front end), so "driving" means running the artifact-schema CLI, the example/JSON-Schema regeneration, the FastF1 session helpers and the exploration notebook against the local cache. Use after editing src/schema.py, src/session.py, src/data_explore.py, src/config.py, docs/examples/make_examples.py or nb/*.ipynb.
---

# Verify race-preds

Surface: a Python library plus CLIs, driven from a shell. Nothing listens on a port, so
there is no launch/teardown of a server. Start from `features/README.md` and pick the
feature file that matches what you touched.

The owner writes the code in this repo (see `CLAUDE.md`). This skill never edits `src/`,
notebooks or `docs/examples/`: every drive below runs read-only against the repo or in a
scratch copy.

## Launch

```bash
cd /Users/lizhezhao/文档/GitHub/race-preds        # always the repo root, not nb/
source .venv/bin/activate                          # Python 3.12; system python3 is 3.9 and will fail
export EV=outputs/verify/$(date +%Y%m%d-%H%M%S)    # evidence dir, gitignored via outputs/
export SCRATCH=$(mktemp -d)                        # scratch copies, removed in Cleanup
mkdir -p "$EV"
```

If `.venv` is missing: `uv venv --python 3.12 .venv && source .venv/bin/activate && uv pip install -r requirements.txt`.

Ready = `Doctor` below prints no `FAIL`. Python scripts that touch FastF1 must start with
`from src.config import enable_cache; enable_cache()`, otherwise FastF1 silently uses
`~/Library/Caches/fastf1` and re-downloads.

## Doctor

Read-only. Run first, and again whenever a drive behaves oddly.

```bash
python - <<'EOF'
import sys, importlib
ok = sys.version_info[:2] == (3, 12)
print(("ok  " if ok else "FAIL"), "python", sys.version.split()[0], "(need 3.12)")
for m in ("pydantic", "fastf1", "pandas", "numpy"):
    try: print("ok  ", m, importlib.import_module(m).__version__)
    except Exception as e: print("FAIL", m, e)
for m in ("jupyterlab", "nbclient"):   # only needed by the notebook feature
    try: importlib.import_module(m); print("ok  ", m)
    except Exception: print("WARN", m, "missing (notebook feature not drivable until installed)")
from pathlib import Path
c = Path("data/fastf1_cache/2025")
print(("ok  " if c.exists() else "WARN"), "cache", len(list(c.glob("*"))) if c.exists() else 0, "2025 events cached")
EOF
git status --short | head -20   # know what is already dirty so you don't blame your run for it
```

`WARN jupyterlab missing` is the known state of this checkout even though
`requirements.txt` lists it. A WARN on cache means FastF1 drives will hit the network.

## Drive

Each feature has its own recipe under `features/`. The shortest end-to-end smoke, about
five seconds and fully offline, is:

```bash
python -m src.schema check docs/examples/v1/2025/16; echo "exit=$?"
```

Expect `docs/examples/v1/2025/16: OK` and `exit=0`. Anything that touches `src/schema.py`
also needs the regeneration round trip in `features/schema-regeneration.md`.

## Evidence

Write proof into `$EV` (`outputs/verify/<timestamp>/`). It is gitignored and survives
Cleanup. For each drive capture:

- the exact command, its stdout/stderr and its exit code, e.g. `cmd > "$EV/<feature>.txt" 2>&1; echo "exit=$?" >> "$EV/<feature>.txt"; cat "$EV/<feature>.txt"` (the shell is zsh; `PIPESTATUS` is bash-only, so don't pipe through `tee` if you need the exit code)
- the resulting state, not only the final line: the printed shapes, columns, diff output
  or validation messages the feature file names as its end state
- for anything that should *fail* (a corrupted round, an invalid stage) the failing run
  too, since a check that cannot fail proves nothing

Proof standards:

- Run the real entry point (`python -m src.schema ...`, the public functions in `src/`),
  not private helpers or hand-built objects.
- Side effects count. `make_examples.py` and `schema export` write files, so show a
  `diff -r` against the committed copy rather than trusting "wrote N files".
- Do not mock FastF1/Ergast. The local cache under `data/fastf1_cache/` is the isolation
  boundary; a run that reaches the network is not offline proof, say so if it happens.
- Never claim a notebook section ran unless its cell executed and produced output. See
  `features/exploration-notebook.md` for what this checkout can and cannot do.

## Isolation

`make_examples.py` derives `ROOT` from its own location and overwrites
`docs/examples/v1` in place. Never run it in the repo. Copy `src/` and
`docs/examples/make_examples.py` into `$SCRATCH` and run it there, as shown in
`features/schema-regeneration.md`. The FastF1 cache is shared and read-mostly; two runs
side by side are fine, but do not delete or rebuild `data/fastf1_cache/` (645 MB,
re-download is slow and rate limited).

## Cleanup

```bash
rm -rf "$SCRATCH"          # scratch copies only; $EV (proof) stays
ls "$EV"                   # confirm the evidence is still there
```

Nothing is running in the background, so there is nothing to kill. Do not delete
`data/`, `.venv` or `outputs/verify/`.

## Helpers

None shipped. Every recipe is a copy-pasteable command in the feature files, so there is
no script to reverse-engineer. If a recipe grows past a screen, tell the owner rather
than adding code to the repo.
