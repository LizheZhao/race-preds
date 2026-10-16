#!/bin/bash
# Link the main checkout's .env and .venv into a worktree that lacks them.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
here="$(git rev-parse --show-toplevel)"
[ "$main" = "$here" ] && exit 0
for f in .env .venv; do
  [ -e "$here/$f" ] || ln -s "$main/$f" "$here/$f"
done
