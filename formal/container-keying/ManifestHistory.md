# Manifest history availability

[`ManifestHistory.tla`](./ManifestHistory.tla) checks that accepted signed
histories remain readable when verification markers are lost or retired, and
that reaching a verification budget never prevents revocation.

| Model action or predicate | Production seam |
| --- | --- |
| `Read` / `Readable` | `verifyStoredContainerManifest` and `verifyStoredDocumentManifest` authenticate retained history |
| `IterativeVerification` | `verifyStoredManifestGraph` walks dependencies with an explicit stack rather than rejecting a lifetime history depth |
| `Restart` / `warm` | `accessManifests.verificationMac` markers only accelerate reads; cleared markers, a rotated secret or new verifier version must preserve acceptance |
| `Commit` / `Revoke` | `verifyStoredContainerManifest` verifies the previous manifest before mutation authorization; lifetime history length adds no mutation refusal |
| `WithinSameKekBudget` / `Rekey` / `RotationAllowed` | `MAX_SAME_EPOCH_MANIFEST_HISTORY` refuses a mutation past 1,024 manifests under one container key with "rekey required"; a rekey or revoke starts a new key |
| `Recite` | `deriveUnrotatedContainerManifestState` refuses a recite at or past `MAX_CONTAINER_RECITATION_EPOCH` (512), an absolute epoch ceiling a rekey does not reset |
| `held` / `Evict` | `writeVerifiedManifestBundlesInTransaction` stores bundles in the transaction that finalizes their projection's checkpoints, bounded and pruned oldest first; damaged rows are dropped by `loadVerifiedManifestCitations` |
| `Citable` / `CiteHeldBytes` | `heldManifestCitations` copies the exact stored bytes a request cites, at most `KNOWN_MANIFEST_HINT_LIMIT` hashes |
| `Omitted` / `OmitOnlyCited` | `encodeContainerWriterProjection` and `encodeDocumentWriterProjection` omit only hashes the request cited, after the ordinary build, authorization and stored-evidence verification |
| `Rebuilds` / `RefetchUncited` | `decodeContainerWriterProjection` and `decodeDocumentWriterProjection` fill omissions only from the cited bytes; a gap makes `citedProjectionRead` refetch once with no hints |

The model abstracts one valid object history, with complete retained evidence
and an authorized actor. A device's durable verified-bundle table is the set
`held` of versions whose bytes it stores; `known` models the rejected design of
a hash-only table whose bytes may be gone. It does not model signatures,
missing dependencies, cycles, hierarchy depth, or storage corruption. Runtime
regressions exercise the real signature verifier and histories longer than
4,096 entries. The history counter saturates only to keep the model
finite; revocation still has an enabled transition at the model boundary.

The positive configuration makes `Readable` unconditional: it specifies the
intended acceptance contract, not the traversal algorithm. The two negative
controls supply the meaningful counterexamples to rejected designs. Bounded
cold verification with unrestricted commits violates `HonestReadsAvailable`
after a warm history grows and the process restarts. Capping mutations at the
read limit preserves reads but violates `RevocationAvailable`. These are
enabled-action safety checks, not claims of eventual network or scheduler
progress.

Production has no lifetime history-depth refusal, but it has two key-scoped
budgets, both in the model at small bounds. A container key carries at most
1,024 manifests: past that the API refuses a same-key mutation with "rekey
required". A rekey or revoke rotates the key, so it is never refused by that
budget (`RekeyAvailable`, `RevocationAvailable`); with
`RotationBypassesBudget = FALSE` the full budget strands the container and TLC
reports both. A recite is refused at an absolute manifest epoch of 512, which
reserves half of the same-key budget for ordinary mutations and does not reset
on rekey; the other mutations stay available past it.

Each mutation runs
the stored-history verifier over the manifest it stores and marks it, and a
projection read writes back the markers it earned after committing. A marker is
a MAC under a key derived from a server-held secret over the manifest hash, a
digest of that manifest's complete stored bundle, its signer's stored key and
the crypto and API rule revisions. Verification stops at the first valid
marker; the database is still not a trust boundary, since an edited row,
changed signer key or forged marker makes that manifest verify in full
wherever the server verifies it.
Document ancestor queries share a request-local binary ancestor index: indexing
N manifests uses O(N log N) time and space, and each indexed lineage query
takes O(log N). The index expands only down to requested floors.

Writer projections cite each manifest by hash. A projection read may
list, in `x-known-manifests`, up to 48 manifest hashes whose verified bundles
the device durably holds; the API omits exactly those it would have served and
names them in `omittedBundles`. The device refills each omission from the bytes
it cited and verifies the rebuilt projection as if it had arrived whole, so a
held bundle is evidence bytes, never a verification result. `Read` checks the
two rules that keep honest reads available whatever the device evicted: cite
only held bytes (`CiteHeldBytes`) and omit only what was cited
(`OmitOnlyCited`). The registered configuration proves them sufficient without
the production refetch; each negative control drops one rule and TLC finds an
honest refusal. `Read` lets a request cite any subset of held bytes, so the
production selection (the read object's lineage and its organization's recent
rows, never another organization's) needs no separate abstraction; the identity
a read is bound to is outside this model. `RefetchUncited` models the production
fallback: a rebuild gap refetches once with no citations, which an honest API
serves in full. Losing the table (`Evict` to nothing) therefore yields a
complete response, and no device depends on another's cache. The API still walks
and verifies every manifest it cites, because its own KEK verification consumes
those states and the served policy evidence must cover every bundle the device
re-verifies; citation saves bytes, not server work. See [the transport
contract](../../docs/projection-policy-evidence.md#cost-and-retained-history-tradeoff).
No existing history is trusted merely because its depth is large.
Regressions cover a full 4,098-entry verification without markers, a marked
history that is neither walked nor re-signed, edited rows, forged markers and a
rotated secret. The model does not abstract markers.
