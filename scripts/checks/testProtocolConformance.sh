#!/usr/bin/env sh

# Pure protocol-conformance tests cheap enough for the always-on lint job:
# the TypeScript/TLA+ baseline-dominance parity suite plus the validators
# schema, operation-registry, and OpenAPI conformance suites. The TLC model
# cannot detect defects in the dominance predicate itself (its invariants are
# stated with the same operators), so the parity suite is the ground truth
# and must run on every push and pull request. DB-backed API tests stay in
# the gated build job.

set -eu

cd "$(git rev-parse --show-toplevel)"

exec bun test \
  packages/api/src/documents/documentBaselineDominance.test.ts \
  packages/validators/src
