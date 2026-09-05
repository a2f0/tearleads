#!/bin/bash
# Refuse a Stripe configuration whose mode does not match the deployment tier.
#
# Staging must run Stripe test mode end to end and production must run live
# mode end to end: the secret key the API signs requests with, the publishable
# key the web bundle inlines, the three fixed-tier Price IDs, and the webhook
# signing secret all belong to one Stripe mode. `load_secrets_env` layers the
# tier file over `root.env`, so a live key left in the shared file silently
# reaches staging with test-mode prices, and the API then rejects its own
# catalog at runtime. Fail here instead, before any artifact is rendered or
# bundled. Values are never printed; only variable names and expected prefixes.

_stripe_env_prefix_error() {
  local name="$1"
  local expected="$2"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    printf '  - %s is not set\n' "$name"
    return 0
  fi
  case "$value" in
    ${expected}?*) return 0 ;;
  esac
  printf '  - %s must start with %s\n' "$name" "$expected"
}

validate_stripe_env() {
  local tier="$1"
  local mode
  local server_key_prefix

  case "$tier" in
    staging) mode="test" ;;
    prod) mode="live" ;;
    *)
      echo "ERROR: Unknown deployment tier: $tier" >&2
      return 1
      ;;
  esac

  # A full secret key or a restricted key both authenticate the API; either
  # must carry the tier's mode.
  case "${STRIPE_SECRET_KEY:-}" in
    rk_*) server_key_prefix="rk_${mode}_" ;;
    *) server_key_prefix="sk_${mode}_" ;;
  esac

  local problems
  problems="$(
    _stripe_env_prefix_error STRIPE_SECRET_KEY "$server_key_prefix"
    _stripe_env_prefix_error BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY "pk_${mode}_"
    _stripe_env_prefix_error STRIPE_WEBHOOK_SECRET "whsec_"
    _stripe_env_prefix_error STRIPE_SYNC_SOLO_PRICE_ID "price_"
    _stripe_env_prefix_error STRIPE_SYNC_TEAM_5_PRICE_ID "price_"
    _stripe_env_prefix_error STRIPE_SYNC_TEAM_10_PRICE_ID "price_"
  )"

  if [[ -n "$problems" ]]; then
    echo "ERROR: Stripe configuration for the $tier tier must be complete and in $mode mode:" >&2
    printf '%s\n' "$problems" >&2
    echo "Shared credentials live in .secrets/root.env (test mode); the live key, publishable key, and prices belong only in .secrets/prod.env." >&2
    return 1
  fi
}
