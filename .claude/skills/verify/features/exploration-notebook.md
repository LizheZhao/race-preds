# Exploration notebook

`nb/fastf1-data-explore.ipynb` is the Phase 1 deliverable and the map of the pipeline:
sections 1 to 9 (one per dashboard panel plus availability map and cost table) and 10 to
14 (season results, session summaries, long runs, feature table, minute timeline).
66 cells, kernel `python3`, about 680 KB with committed outputs.

## Sub-features

- Sections 0 to 9: schedule, results, weather (Open-Meteo), circuit, laps/tyres, track
  status, telemetry, Ergast, availability map.
- Sections 10 to 14: apply `src/data_explore.py` (see
  [session-summary-timeline.md](session-summary-timeline.md)).

## How to get to it (user POV)

`jupyter lab` from the repo root, open the notebook, run top to bottom. Section 9 is the
contract for the Phase 2 refresh job.

## Driving it with the shell

Current state of this checkout: `jupyterlab` and `nbclient` are **not installed** in
`.venv` although `requirements.txt` lists `jupyterlab`, so the notebook cannot be
executed headlessly yet. Doctor reports it as `WARN`. To drive it, ask the owner before
touching their venv, then:

```bash
uv pip install -r requirements.txt && uv pip install nbclient nbformat   # nbclient comes with jupyterlab; shown for clarity
cp nb/fastf1-data-explore.ipynb "$SCRATCH/run.ipynb"
python -m jupyter nbconvert --to notebook --execute "$SCRATCH/run.ipynb" \
  --ExecutePreprocessor.timeout=1800 --output-dir "$EV" 2>&1 | tee "$EV/notebook-exec.txt"
```

Execute a copy, never `nb/` in place: execution rewrites 680 KB of committed outputs.
This recipe has **not** been run on this checkout. Until it has, do not claim the
notebook was verified as a whole.

What can be verified now without Jupyter: the code the notebook calls. Prove the changed
section's functions with the matching feature file, and check the cell source parses:

```bash
python - <<'EOF'
import json, ast
nb = json.load(open("nb/fastf1-data-explore.ipynb"))
bad = 0
for i, c in enumerate(nb["cells"]):
    if c["cell_type"] != "code": continue
    src = "".join(l for l in c["source"] if not l.lstrip().startswith(("%", "!")))
    try: ast.parse(src)
    except SyntaxError as e: bad += 1; print("cell", i, "SyntaxError:", e)
print("code cells with syntax errors:", bad)
EOF
```

That is a syntax check only, not proof the notebook runs; say so when you report it.

Observable end state for a full run: `$EV/run.ipynb` exists, no cell has an `error`
output (`jq '[.cells[].outputs[]? | select(.output_type=="error")] | length'` is 0), and
the section you changed has output matching its markdown claims.

## Gotchas

- Run Jupyter from the repo root. The notebook resolves `ROOT` by checking
  `Path.cwd().name == "nb"`; `nbconvert` run from the root with a scratch copy still
  works because that branch only trims the path, but prefer the root.
- Sections 3 and 8 call Open-Meteo and jolpica (network, rate limited). Section 7 loads
  telemetry (tens of MB per session). A full run is slow and not offline.
- Cell outputs in the committed file are the owner's evidence; do not overwrite them.
