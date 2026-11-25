#!/usr/bin/env sh

# Pure protocol-conformance tests cheap enough for the always-on lint job:
# the TypeScript/TLA+ baseline-dominance parity suite, the transparency proof
# matrices (exhaustive prefix completeness against an independent root oracle
# plus mutation negatives and fast-check properties, and the Lean model's
# transparency vectors), the keying verifier properties (fast-check plans
# materialized into signed manifests, policies, and key states, each forgery
# paired with its accepted honest twin), the validators schema,
# operation-registry, and OpenAPI conformance suites, and the API-client
# transport-surface guard that keeps every registered operation claimed by
# exactly one low-level transport. The TLC model cannot detect defects in the
# dominance predicate itself (its invariants are stated with the same
# operators), so the parity suite is the ground truth and must run on every
# push and pull request. DB-backed API tests stay in the gated build job.

set -eu

unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
cd "$(CDPATH='' cd -P -- "$(dirname -- "$0")/../.." && pwd -P)/scripts"

exec bun test \
  ../packages/api/src/documents/documentBaselineDominance.test.ts \
  protocol/lintFormalAbstractionMaps.test.ts \
  protocol/restartProbeTraceModule.test.ts \
  protocol/protocolNegativeControls.test.ts \
  protocol/tlcTools.test.ts \
  protocol/leanTools.test.ts \
  protocol/failFastPool.test.ts \
  protocol/noBrickTraceModule.test.ts \
  ../packages/api/src/documents/documentBaselineDominanceTraceReplay.test.ts \
  ../packages/crypto/src/keying/transparency/transparencyProofs.test.ts \
  ../packages/crypto/src/keying/transparency/transparencyProofMutations.test.ts \
  ../packages/crypto/src/keying/transparency/transparencyLeanVectors.test.ts \
  ../packages/crypto/src/keying/properties/keyingProperties.test.ts \
  ../packages/crypto/src/keying/properties/keyingPathProperties.test.ts \
  ../packages/api-client/src/operationTransportSurface.test.ts \
  ../packages/validators/src
