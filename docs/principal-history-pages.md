# Incremental principal-policy verification

`createPrincipalPolicyHistoryVerifier` in `@tearleads/crypto` verifies a signed
principal history from genesis in successive pages. It shares the existing
full-history verifier's commitment, identity, signer-authorization, transition,
and signature checks. The caller supplies the authenticated signer keys and any
already verified external authority for each page.

An append contains one to 128 entries. The verifier owns its inputs before
asynchronous work, stages all checks, and publishes progress only when the whole
page succeeds. A rejected page can be corrected and retried. Concurrent appends
and finishing during an append fail closed with `invalid_shape`; that code can
also describe malformed page data. Pages must be contiguous; duplicate, skipped,
wrong-principal, and forked successors are rejected.

Between pages it retains an index frontier (at most 53 hashes), the latest
checked entry, the most recent external admin citation, the observed
local-checkpoint hash, and explicitly requested
historical entries. A page conflicting with the local checkpoint is rejected
after its signatures pass, before publishing its progress. Uncited states
preserve the prior external-admin citation, so a later page cannot roll
authority back. A successful `finish(expectedHead)` requires the exact current
head, including its key epoch and fingerprint, and connection to the optional
local checkpoint. Returned entries are readonly views inside a copy.
Deliberately mutating that copy at runtime cannot change the verifier's
progress. The verifier may continue after a successful finish, allowing callers
to observe exact verified intermediate heads.

`VerifiedPrincipalPolicyHistory` deliberately differs from a full policy
snapshot. Its `retainedEntries` contains the requested entries encountered so
far plus the current entry, ordered by version; callers must not index it by
version or treat it as a complete history. At most 128 reference requests are
accepted per verifier; duplicate versions are rejected. The factory throws
`KeyingVerificationError` for invalid scope, checkpoints, or reference requests.
The returned verifier has result-returning `append` and `finish` methods. These
are batch/retention limits, not lifetime policy-version limits. A caller
processing more historical references can consume successive verified prefixes
in bounded batches.

An accepted append also returns content-addressed `indexNodes`. These are
untrusted proof material for a Merkle index whose leaves bind each accepted
entry's six head fields and exact signature bytes. Only accepted pages advance
the private root. The node-hashing and inclusion-proof routines are shared with
the transparency tree; the principal-history leaf has a separate hash domain.
This does not introduce a transparency authority, witness or gossip dependency.

`createPrincipalHistoryIndexProof` reads at most one node per tree level from a
caller-owned node store. It validates every node's hash while constructing a
proof. `verifyPrincipalPolicyHistoryReferences({ history, references })` checks
up to 128 requested entries against the private root of an issued history
capability. It checks their head fields, signed-state hash, projection and grant
commitments, and proof position/size; it does not repeat signature verification.
An independently signed fork is insufficient: the exact entry must belong to
this accepted prefix. Proof paths have at most 53 hashes.

Successful selection returns a new capability containing only those references
and the current entry. It does not grow the original selection or verifier.
Changing selections therefore needs no genesis replay. Callers that need this
reuse should export progress with a stable empty retained-reference selection,
then select references after finishing. The progress input binding itself still
requires exact normalized inputs on restoration.

Callers persist returned nodes alongside accepted progress; missing nodes require
rebuilding proof material from verified pages. Node rows cannot establish a
trusted root, and public result-field edits cannot replace the private root.
The frontier uses logarithmic verifier memory; retaining nodes for every observed
prefix can use O(N log N) storage. This component does not prune that store.

The entry budget bounds history depth per append, not the size of one signed
projection or grant set. Transport code must bound serialized bytes, dependency
work, and concurrency. External authority must already be authenticated by the
caller; supplying a projection from an untrusted page does not establish that
its signer is an admin. This API does not verify encrypted payloads or member
key envelopes, and its result cannot stand in for a verified full keying bundle.

`verifyPrincipalPolicyCurrent({ current, history })` checks current payload and
member envelopes against a successfully finished history. It also checks the
current projection, grants, header hash, and exact accepted signature bytes.
The distinct result type, `VerifiedPrincipalPolicyCurrent`, exposes only
`retainedHistory`. It cannot be passed to full-history policy consumers.
Authorization helpers
accept the separate `PrincipalPolicyAuthorization` union and resolve only exact
current or explicitly retained citations. A historical membership citation does
not restore current access after revocation.
Consumers must request any checkpoint or historical references they need, and
select retained entries by version. They must not infer invariants over omitted
entries from this subset. The verifier uses a private snapshot of the issued
history capability; serialized copies and edits to its public fields cannot
substitute a different verified prefix.
The live history capability belongs to one loaded copy of the crypto package;
another bundled copy cannot consume it. Across runtimes or workers, export and
authenticate progress through restore instead of passing a serialized result.

The verifier can export its accepted private state with
`exportProgress({ localKey, context })`. `localKey` must be a private 32-byte key
controlled by the local verifier; a client must never obtain it from the API.
The implementation derives a key per normalized binding with HKDF-SHA-256 and
encrypts the snapshot with AES-256-GCM and a fresh random nonce. Its authenticated
data binds the verification revision, local operation context, principal scope,
local checkpoint, and requested references. The snapshot preserves the predecessor,
authority citation, checkpoint connection, retained entries, and index frontier.
The frontier's shape must match the accepted prefix length. The v3 format has no
older-format reader; previously saved formats are discarded and reverified.

`restorePrincipalPolicyHistoryVerifier(input, savedProgress, protection)`
returns a verifier only after authenticating and checking the saved state.
It requires the same normalized input and protection context used for export.
Only protocol fields are saved; checkpoint metadata and reference ordering do
not affect the binding. A changed
checkpoint, scope, reference set, context, or key refuses resumption; callers
can verify signed pages again from genesis. Losing or rotating the protection
key has the same safe fallback. Changing accepted verification rules requires
bumping `PRINCIPAL_HISTORY_VERIFICATION_REVISION` next to the page verifier so
earlier attestations are retired. A caller whose identity trust policy changes
retrospectively must also change its context or key. Ordinary membership removal
does not erase historical authorization; current authorization is checked anew.
This is the local verifier reusing its own checked history, not accepting a
remote checkpoint as evidence of an omitted prefix.

Export refuses an in-flight append. Once export captures an accepted prefix,
later appends cannot change it while encryption is running. Partial progress
can be saved before reaching an existing checkpoint, but `finish` continues to
refuse a prefix below that checkpoint. Only successful `finish(expectedHead)`
can establish the requested head; saving progress does not publish a new trusted
application checkpoint or authorize a mutation.

Authenticated progress does not by itself prevent replay of an older saved
prefix under the same inputs. The caller owns durable key custody, byte limits,
atomic storage of staged evidence and progress, and ordering concurrent writes.
It must bind its local context to the intended operation and recheck the latest
trusted checkpoint before publishing results. If that checkpoint changed during
a suspended operation, the caller must resolve the new input before resuming.
Persisted records and cryptographic progress must not be promoted independently.

This component supports #2448. Existing API and SDK paths still use full-history
transport. Remaining work includes bounded HTTP delivery, durable persistence
and replay ordering, server-side preparation outside the mutation transaction,
and a short atomic commit and acknowledgement. Issues #2442 and #2448 stay open
until that integration meets the HTTP availability requirements.

The API `readPrincipalHistoryPage` reader selects at most 100 state rows per
query, with explicit principal scope and lower/upper version bounds. Its
`listPrincipalStateHistory` collector fixes the upper bound to the requested
head, then reads successive pages and rejects a missing version. Other history
readers have their own query bounds. The collector still returns the complete
array; these query bounds alone
do not bound response bytes, total retained memory, or work per HTTP request.

The crypto regressions exercise page failure, input ownership, signatures,
predecessors, authorization, key rotation, grant commitments, external
authority, and checkpoints. The [page
model](../formal/container-keying/PrincipalHistoryPages.md) checks atomic
progress publication and authority retention with negative controls. The default
availability test crosses two full pages, exports and restores between pages,
and retains only the current entry. Run
`bun run --cwd packages/crypto test:principal-history` for the same streaming
check through version 16,385. This crypto-only check does not replace the API's
full revocation/recovery scenario.

The [resumption model](../formal/container-keying/PrincipalHistoryResume.md)
checks that an authenticated restore preserves the checked prefix, its binding,
and the authority citation. It assumes the local key remains private and does
not model database transactions or HTTP request deadlines.

The API stores authenticated prefix progress in `principal_history_progress`.
The private server key, verification revision, policy/strict-Admins mode, and
scope bind each record. API preparation uses an empty retained-reference selection
so a different requested citation reuses the same verified prefix. Lookup columns
are untrusted hints;
restoration authenticates the exact saved head and rechecks its final stored
state, projection, grants, and signer identity. Changed rules or keys start
verification again. Transactions buffer hints and publish each row in its own
autocommit after success, so readers cannot deadlock by locking hint rows in
opposite orders. Publication failures are reported without changing the
transaction result. Rolled-back hints are discarded; conditional deletion of
an invalid hint can run after rollback. Savepoint effects wait for the outer
transaction to finish. Index nodes are published before progress that uses them.

The `principal_history_index_nodes` table stores untrusted proof material keyed
by hash. Selecting an older citation reads its entry and a logarithmic inclusion
proof, then checks both against the private root from the locally restored
verifier. A changed entry or signature fails verification. Missing or corrupt
nodes trigger a rebuild from signed history; each recovery attempt removes at
most 32 old progress hints from the matching scope and protection generation.
Transaction-local resets can rebuild immediately, but publish rebuilt nodes and
progress only after a successful outer commit. Cache loss costs verification
work and never supplies authority or requires a principal repair write. These
tables have no pruning policy yet.

Preparation shares a preferred 32-entry, 2 MiB, five-second budget across a
policy and its authority dependency. At least one entry can advance even if it
exceeds the preferred byte/time budget; discovering an unresolved dependency
can also inspect one parent entry. These are scheduling targets, not strict
bounds on total request memory or elapsed time. Proof selection and cache
maintenance add work outside that accepted-entry budget. The current API
collector still loops through preparation batches, and full wire responses still
collect arrays.
Moving cold preparation outside the final transaction and across HTTP requests
remains required before #2442/#2448 can close.

Current authorization consumes `PrincipalPolicyAuthorization` and explicitly
retained historical citations. More than 128 required citations are verified in
separate batches, each ending at the same exact current head. Every batch proves
inclusion in that verified history without replaying its signatures. Current
payloads, member envelopes, and applicable external
Admins artifacts are checked from storage before use. Current membership still
controls live access, even when a historical citation includes a removed member.
