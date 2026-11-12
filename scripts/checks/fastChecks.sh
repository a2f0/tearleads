# shellcheck shell=sh
# Shared by check:fast (CI) and pre-push. The caller sources stepTimings.sh
# and starts its timer so each check remains visible in the push timing log.

run_protocol_check() {
  if [ "${CI_TURBO_PROTOCOL_CACHE:-}" = "1" ]; then
    bun scripts/checks/runCachedProtocolCheck.ts "$1"
  else
    bun run "$1"
  fi
}

# The two pure TLC passes read only formal models and repository scripts, never
# build output, and are the slowest fast checks. The pre-push gate runs them in
# a background lane and calls defer_model_checks to skip them here.
defer_model_checks() {
  fast_checks_defer_models=1
}

run_model_check_inline() {
  [ -z "${fast_checks_defer_models:-}" ] || return 0
  step_timings_run "$1" run_protocol_check "check:$1"
}

run_fast_checks() {
  step_timings_run devkit bun run --cwd packages/app-electrobun prepare:devkit
  step_timings_run biome bun run lint:biome
  step_timings_run package-assertions bun run lint:package-assertions
  step_timings_run canonical-ordering bun run lint:canonical-ordering
  step_timings_run knip bun run lint:knip:all
  step_timings_run knip-production bun run lint:knip:production
  step_timings_run knip-tests bun run test:knip:production
  step_timings_run architecture bun run lint:architecture
  step_timings_run architecture-tests bun run test:architecture
  step_timings_run file-names bun run lint:files
  step_timings_run skill-placeholders bun run lint:skill-placeholders
  step_timings_run agent-skills bun run agents:check
  step_timings_run source-shape-worktree bun run lint:source-shape
  step_timings_run openapi bun run lint:openapi
  step_timings_run openapi-compatibility bun run lint:openapi:compatibility
  step_timings_run api-migrations bun run lint:api-migrations
  step_timings_run openapi-tests bun run test:openapi:compatibility
  step_timings_run protocol-model-tests bun run test:protocol-models
  run_model_check_inline protocol-models
  step_timings_run protocol-traces bun run check:protocol-traces
  step_timings_run protocol-projection bun run check:protocol-projection
  run_model_check_inline protocol-negative-controls
  step_timings_run no-brick-projection bun run check:no-brick-projection
  step_timings_run formal-maps bun run lint:formal-maps
  step_timings_run protocol-conformance bun run test:protocol-conformance
  step_timings_run infrastructure-parity bun run lint:infrastructure-parity
  step_timings_run scope-tools bun run test:scope
  step_timings_run static-analysis bun run test:static-analysis
  step_timings_run binary-files-worktree bun run lint:binary-files
  step_timings_run ruby bun run lint:ruby
  step_timings_run shellcheck bun run lint:scripts
  step_timings_run timing-tests bun run test:step-timings
  step_timings_run install-tests bun run test:install-dependencies
  step_timings_run npm-publish-tests bun run test:npm-publish
  step_timings_run markdown bun run lint:markdown
  step_timings_run doc-links bun run lint:doc-links
}
