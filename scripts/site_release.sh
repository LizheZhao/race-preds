#!/usr/bin/env bash
# The published v1 tree, mirrored as one asset of the GitHub Release tagged "published".
# It is what the Pages deploy serves and what a publish starts from (earlier snapshots,
# stale fallbacks), so neither needs Databricks (docs/pipeline-plan.md, Fallback).
#
#   scripts/site_release.sh download <v1 dir>   # replace <v1 dir> with the released tree; exit 1 if none yet
#   scripts/site_release.sh upload <v1 dir>     # check, pack and replace the asset (needs gh, authenticated)
#
# Download is a plain HTTPS fetch (the repo is public). Upload uses the gh CLI, which
# GitHub-hosted runners have, and GITHUB_TOKEN with contents: write there.
set -euo pipefail

repo=${GITHUB_REPOSITORY:-LizheZhao/race-preds}
tag=published
asset=published-v1.tar.gz
command="${1:?usage: scripts/site_release.sh download|upload <v1 dir>}"
site="${2:?usage: scripts/site_release.sh download|upload <v1 dir>}"
here=$(cd "$(dirname "$0")" && pwd)

case "$command" in
  download)
    tmp=$(mktemp -d)
    if ! curl -fsSL -o "$tmp/$asset" "https://github.com/$repo/releases/download/$tag/$asset"; then
      echo "no published tree yet ($repo release '$tag')" >&2
      rm -rf "$tmp"
      exit 1
    fi
    rm -rf "$site" && mkdir -p "$site"
    tar -xzf "$tmp/$asset" -C "$site"
    rm -rf "$tmp"
    echo "downloaded $repo@$tag/$asset -> $site"
    ;;
  upload)
    "$here/check_site.sh" "$site"
    tmp=$(mktemp -d)
    tar -czf "$tmp/$asset" -C "$site" .
    if [[ "${DRY_RUN:-}" == 1 ]]; then
      echo "dry run: would upload $(du -h "$tmp/$asset" | cut -f1) to $repo@$tag/$asset"
      tar -tzf "$tmp/$asset" | head -5
      rm -rf "$tmp"
      exit 0
    fi
    gh release view "$tag" --repo "$repo" >/dev/null 2>&1 \
      || gh release create "$tag" --repo "$repo" --title "Published site" --latest=false \
           --notes "The published v1 data tree (scripts/site_release.sh). Replaced on every publish."
    gh release upload "$tag" "$tmp/$asset" --repo "$repo" --clobber
    rm -rf "$tmp"
    echo "uploaded $site -> $repo@$tag/$asset"
    ;;
  *)
    echo "unknown command '$command'" >&2
    exit 2
    ;;
esac
