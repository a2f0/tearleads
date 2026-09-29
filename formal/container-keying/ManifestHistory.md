# Manifest history availability

[`ManifestHistory.tla`](./ManifestHistory.tla) models issue #2365 finding #6:
accepted signed histories must remain readable when verification markers are
lost or retired, and reaching a verification budget must not prevent revocation.

| Model action or predicate | Production seam |
| --- | --- |
| `Read` / `Readable` | `verifyStoredContainerManifest` and `verifyStoredDocumentManifest` authenticate retained history |
| `IterativeVerification` | `verifyStoredManifestGraph` walks dependencies with an explicit stack rather than rejecting a lifetime history depth |
| `Restart` / `warm` | `access_manifest_verifications` markers only accelerate reads; a cleared table, rotated secret or new verifier version must preserve acceptance |
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

This repair removes the deterministic history-depth refusal. Each transaction
that stores a manifest runs the stored-history verifier over it and marks it,
with any unmarked history it depends on, using a MAC under a key derived from a
server-held secret over its hash, a digest of the complete stored bundle and the
crypto verifiers' rule revision. Reads only consult markers and stop at the
first valid one; the database is still not a trust boundary, since an edited row
or forged marker falls back to full verification. Document ancestor queries
share a request-local binary ancestor index: indexing N manifests uses
O(N log N) time and space, and each indexed lineage query takes O(log N). The
index expands only down to requested floors. Incremental proof delivery, so a
writer projection need not ship a container's full key history, remains tracked
in [#2365, finding 6](https://github.com/a2f0/tearleads/issues/2365). It must
not become a permanent lifetime-history refusal or a cap that prevents
revocation. No existing history is trusted merely because its depth is large.
Regressions cover a full 4,098-entry verification without markers, a marked
history that is neither walked nor re-signed, edited rows, forged markers and a
rotated secret. The model does not abstract markers.
