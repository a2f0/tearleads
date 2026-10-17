#!/usr/bin/env bash
# Destroy production completely: the API, app, and demo hostnames and Workers
# (the API's Durable Objects hold every session), the PlanetScale database and
# everything in it, the blob bucket, the desktop downloads bucket with every
# published release, and the website.
# Usage: scripts/destroyProduction.sh
#
# This is wider than a greenfield reset, which keeps the downloads bucket; see
# docs/developer/greenfield-reset.md. There is no --auto-approve: the script
# always asks for the production domain before changing anything, and only then
# authorizes the production steps (terraform/scripts/teardownGuard.sh).
# Production data resources set prevent_destroy; terraform/scripts/
# destroy-stack.sh lifts it with temporary overrides for this run only.
# The steps, their order, and their timings are in scripts/lib/destroyTier.sh.

set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "Usage: scripts/destroyProduction.sh" >&2
  echo "There is no --auto-approve; the script always asks for the production domain." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
# The domain is read in a subshell so the prompt does not export production
# secrets to the steps; each step loads what it needs.
DOMAIN="$(
  # shellcheck source=terraform/scripts/common.sh
  # shellcheck disable=SC1091
  source "$REPO_ROOT/terraform/scripts/common.sh"
  load_secrets_env prod >&2
  validate_domain_env
  printf '%s' "${TF_VAR_domain:?}"
)"

echo "This permanently destroys production at $DOMAIN: its hostnames and Workers, every session, the database and everything in it, every stored blob, every published desktop release, and the website." >&2
printf 'Type the production domain (%s) to continue: ' "$DOMAIN" >&2
IFS= read -r answer || answer=""
if [[ "$answer" != "$DOMAIN" ]]; then
  echo "Teardown cancelled; nothing was changed." >&2
  exit 1
fi

export TEARLEADS_TEARDOWN_TIER=prod
# shellcheck source=scripts/lib/destroyTier.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/scripts/lib/destroyTier.sh"
destroy_tier prod
