#!/usr/bin/env bash
# Validate a published v1 tree: index.json, then every round with src/schema.py's cross-file
# checks. Publish is the only exit, so nothing is uploaded or deployed unless this passes.
#   scripts/check_site.sh <v1 dir>
set -euo pipefail
site="${1:?usage: scripts/check_site.sh <v1 dir>}"
python=${PYTHON:-python}

"$python" -c "import sys; from pathlib import Path; from src.schema import load; load(Path(sys.argv[1]), 'index'); print('index.json: OK')" "$site/index.json"
shopt -s nullglob
for manifest in "$site"/*/*/manifest.json; do
  "$python" -m src.schema check "$(dirname "$manifest")"
done
