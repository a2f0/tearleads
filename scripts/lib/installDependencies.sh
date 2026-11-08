#!/usr/bin/env sh
# Install workspace dependencies exactly as locked, retrying transient download
# failures. CI and publish workflows run this instead of a bare install.
#
# The pinned GitHub dependency (@a2f0/continuity) downloads from GitHub's
# archive host, which sometimes answers 5xx; one such response failed every job
# of a run. A frozen-lockfile mismatch fails the same way on each attempt, so
# the retries cost it only the backoff before the same error.
set -eu

attempts=3
attempt=1
while ! bun install --frozen-lockfile; do
  if [ "$attempt" -ge "$attempts" ]; then
    echo "bun install failed after $attempts attempts." >&2
    exit 1
  fi
  delay=$((attempt * 15))
  echo "bun install failed (attempt $attempt of $attempts); retrying in ${delay}s." >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done
