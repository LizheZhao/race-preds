# Feature map

Verification map for race-preds. One file per user-facing feature. A proof that drives
one entry point is incomplete when a file here lists others for the same feature.

| Feature | Touch these files | Needs network | File |
|---|---|---|---|
| Round validation CLI | `src/schema.py`, `docs/examples/v1/**` | no | [schema-check.md](schema-check.md) |
| Schema + example regeneration | `src/schema.py`, `docs/examples/make_examples.py`, `docs/schema/*.json` | no | [schema-regeneration.md](schema-regeneration.md) |
| Weekend session layout | `src/sessions.py` | no (cached schedule) | [session-layout.md](session-layout.md) |
| Session summary + timeline | `src/summaries.py`, `src/timeline.py`, `src/results.py`, `src/sessions.py`, `src/config.py` | no (cached sessions) | [session-summary-timeline.md](session-summary-timeline.md) |
| Exploration notebook | `nb/fastf1-data-explore.ipynb` | partly | [exploration-notebook.md](exploration-notebook.md) |

Not mapped, because they do not exist yet: the Databricks lakehouse and models, the
GitHub Actions dispatcher, and the static front end (`docs/pipeline-plan.md`). When one
lands, add a file here and a launch/doctor section in `../SKILL.md`.

`demo/` is a borrowed reference notebook and dashboard. Do not verify or edit it.
