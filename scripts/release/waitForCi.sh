#!/bin/sh
# Waits for CI's run on a commit of main and exits with its result, so a
# publish job that needs this step ships only a commit CI passed. CI and the
# publish workflows start from the same push; waiting on that run reuses its
# suites instead of repeating them.
#
#   sh scripts/release/waitForCi.sh <commit>
#
# GH_TOKEN needs `actions: read`. CI_WAIT_ATTEMPTS and CI_WAIT_INTERVAL bound
# the wait for the run to appear: 30 attempts, 20 seconds apart, by default.
set -eu

commit=${1:?Usage: waitForCi.sh <commit>}
repository=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is unset}
attempts=${CI_WAIT_ATTEMPTS:-30}
interval=${CI_WAIT_INTERVAL:-20}

attempt=1
while :; do
  run_id=$(gh run list --repo "$repository" --workflow ci.yml --branch main \
    --commit "$commit" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [ -z "$run_id" ] || break
  if [ "$attempt" -ge "$attempts" ]; then
    echo "No CI run on main for $commit after $attempts attempts." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep "$interval"
done

echo "Waiting for CI run $run_id on $commit."
exec gh run watch "$run_id" --repo "$repository" --exit-status --interval 30
