#!/bin/sh
# The root package's postinstall: after `bun install`, install the tracked Git
# hooks (commit-msg, pre-commit, pre-push) when they are missing or stale, so a
# fresh clone gets the push gate without a separate setup step and an existing
# clone picks up hook changes. Up-to-date hooks print nothing.
#
# It never fails the install. CI and a copy without its own Git directory (a
# Docker build context or an exported tree) skip it. A hook that needs a person
# to decide, such as an unmanaged or locally edited copy, is reported and left
# in place; install-hooks.sh explains which and how to adopt it.

[ -z "${CI:-}" ] || exit 0
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "$0")/../.." && pwd -P)" || exit 0
[ -e "$REPO_ROOT/.git" ] || exit 0
command -v git >/dev/null 2>&1 || exit 0
for name in $(git rev-parse --local-env-vars); do unset "$name"; done
cd "$REPO_ROOT" || exit 0

if "$REPO_ROOT/node_modules/.bin/agent-tool" hooks check >/dev/null 2>&1; then
  exit 0
fi
if sh scripts/git/install-hooks.sh >/dev/null 2>&1; then
  echo "Installed the Git hooks (commit-msg, pre-commit, pre-push)."
else
  echo "warning: the Git hooks are not installed; run sh scripts/git/install-hooks.sh to see why (docs/developer/static-analysis.md#ci-and-the-push-gate)." >&2
fi
exit 0
