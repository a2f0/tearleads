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

The positive configuration makes `Readable` unconditional: it specifies the
intended acceptance contract, not the traversal algorithm. The two negative
controls supply the meaningful counterexamples to rejected designs. Bounded
cold verification
with unrestricted commits violates `HonestReadsAvailable` after a warm history
grows and the process restarts. Capping mutations at the read limit preserves
reads but violates `RevocationAvailable`. These are enabled-action safety checks,
not claims of eventual network or scheduler progress.

This first repair removes the deterministic history-depth refusal. Verification
still loads each retained manifest on a cold read. Document ancestor queries
share a request-local binary ancestor index: indexing N manifests uses
O(N log N) time and space, and each indexed lineage query takes O(log N).
The index expands only down to requested floors; it never loads older ancestors
merely to assign a depth. Cold-request resource budgets, persistent markers,
and incremental proof delivery remain tracked in
[#2365, finding 6](https://github.com/a2f0/tearleads/issues/2365). They must not
become a permanent lifetime-history refusal or a cap that prevents revocation.
No existing history is trusted merely because its depth is large.
