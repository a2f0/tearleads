# Manifest history availability

[`ManifestHistory.tla`](./ManifestHistory.tla) models issue #2365 finding #6:
accepted signed histories must remain readable after process-cache eviction,
and reaching a verification budget must not prevent revocation.

| Model action or predicate | Production seam |
| --- | --- |
| `Read` / `Readable` | `verifyStoredContainerManifest` and `verifyStoredDocumentManifest` authenticate retained history |
| `IterativeVerification` | `verifyStoredManifestGraph` walks dependencies with an explicit stack rather than rejecting a lifetime history depth |
| `Restart` / `warm` | `StoredVerificationCache` is an optional process cache; clearing it must preserve acceptance |
| `Commit` / `Revoke` | `verifyStoredContainerManifest` verifies the previous manifest before mutation authorization; history length adds no new mutation refusal |

The model abstracts one valid object history, with complete retained evidence
and an authorized actor. It does not model signatures, missing dependencies,
cycles, hierarchy depth, storage corruption, or key-epoch bounds. Runtime
regressions exercise the real signature verifier and histories longer than the
former 4,096-entry limit. The history counter saturates only to keep the model
finite; revocation still has an enabled transition at the model boundary.

Two negative controls reproduce the rejected designs. Bounded cold verification
with unrestricted commits violates `HonestReadsAvailable` after a warm history
grows and the process restarts. Capping mutations at the read limit preserves
reads but violates `RevocationAvailable`. These are enabled-action safety checks,
not claims of eventual network or scheduler progress.

This first repair removes the deterministic history-depth refusal. Verification
still uses memory and time proportional to retained evidence on a cold read.
Persistent verification markers and incremental proof delivery remain separate
work; no existing history is trusted merely because its depth is large.
