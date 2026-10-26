# Principal-history cache retention

Completed-prefix publication and atomic current acknowledgements reclaim older
completed stages in the same transaction. Each pass retains the two newest
completed stages through the published head and deletes at most 16 older rows.
It preserves newer, incomplete, other-scope and other-organization progress. The
scope index bounds candidate selection without sorting all stored stages. Each
stage row's `scope_id` and `touched_at` columns are eviction hints; only private
authentication permits recovery reuse. An authenticated completed stage or
prefix of the exact pinned head serves online recovery without a confirmation
read; if its stored current artifacts fail verification, the stage is discarded
and signed history is replayed online once. Evicting such a stage costs only
requests while online. The per-operation directory and Admins memo above these
rows lives in memory only and persists nothing; see
[current-policy consumers](current-principal-consumers.md) for its eviction
rules.

Organization provisioning (registration and each additional organization)
writes the first completed stages for the founding organization, Admins and
Members heads. Once the provisioning response acknowledges the commit and the
bootstrap pins those heads, the SDK runs scoped recovery over the states the
device itself signed, served from memory rather than the network. Priming is
bound to the provisioning scope, captured before its first await: the
database the bootstrap committed to, the identity whose key signed the states,
and a protection lease for them. It reads the founder's existing trust pin and
never writes one. Every step and every progress transaction rechecks that
scope, so an identity or database switch aborts priming with no durable write.
The ordinary verifier checks signatures, the directory binding and the strict
Admins rules before any progress is saved, so the first runtime recovery of a
founding head reads only directory discovery. Priming never performs HTTP; a
failure is logged and leaves the ordinary online recovery in place.

Encrypted member envelopes are retained separately for each principal key
fingerprint before progress is removed. Candidate retention checks the envelope
commitment and never grants authorization. Newer envelopes for the same key
replace older candidates; key rotation retains the old key's candidates. Current
prefixes and the most recent completed predecessor remain available offline.
An older evicted exact private head can require an online replay, while signed
historical reference proofs and old key envelopes remain available. Organization
reset removes the envelope archive and eviction hints along with its other cache
material, preserving durable trust pins.

Keeping the newest envelope set for a principal key relies on the existing
protocol: removing or demoting a member requires new principal key material,
and a remaining user's signing and encapsulation keys cannot change within its
[identity trust domain](trusted-user-identity.md). Valid same-key updates retain
the existing members and their recipient identities. Missing member envelopes
fail projection verification. This retention rule depends on that key
stability. Matching fingerprints alone do not authenticate arbitrary archived
candidates or guarantee availability after local corruption.

Each accepted page also reclaims abandoned incomplete progress in its own scope.
It keeps the current writer and the seven most recently touched other incomplete
stages; a completed writer may keep eight incomplete stages. A pass removes at
most 16 rows, so an existing excess converges over subsequent page writes. It
never removes completed artifacts, other scopes or other organizations through
this path. Recency hints do not authorize recovery.

Completed acceptance also targets eight indexed completed stages per scope. It
always protects the current writer and the two newest completed heads through
the published prefix, then fills the remaining slots by recency. At most 16
excess stages are removed per pass, so an existing backlog converges over later
completed writes. This runs before current-artifact verification can fail;
invalid current payloads cannot accumulate unlimited completed attempts while
the last good prefix remains unchanged. Published offline evidence, incomplete
work, other scopes and other organizations remain protected. Completion and
version filters read the stage row itself, so no separate hint can disagree with
the work it describes. Encrypted key candidates are archived before the bounded
batch is deleted. The same cap applies to completed public-history attempts
interrupted before prefix publication. Public progress contains no private key
candidates; successful public recovery publishes its prefix and removes its own
stage.

An evicted in-flight writer fails its progress compare-and-swap with
`principal_history_stage_changed`; the caller must start another recovery, which
can resume from a surviving authenticated prefix or genesis. The built-in runtime
serializes recovery within an organization, but an acknowledged publication
(`persistAcknowledgedPrincipalCurrents`) writes the private stage of its head
outside that queue, so the queued current-policy resolver
(`createRuntimePrincipalPolicyCurrentResolver`) starts that recovery itself,
once, in the same queue turn (`resumeAfterSupersededStage`). Custom hosts with
overlapping calls must handle this retry. Eviction imposes no history-version cutoff.
Cancellation rolls back page acceptance, key archival and reclamation. Incomplete
cleanup reads only stage identifiers; completed cleanup reads current artifacts
only for its bounded archival/deletion batch. Both use the scoped recency index.

Stored proof nodes that lack graph edges when a write indexes them stay
unmanaged and are never reclaimed; their owners cannot be reconstructed from
unauthenticated metadata alone.

Accepted pages record their computed proof root and each new node's outgoing
edges. Saved stages and prefixes own roots; replacing or removing their exact
progress releases that ownership in the same guarded transaction. Shared child
nodes remain live until all incoming references disappear. Each accepted page,
prefix save and atomic acknowledgement reclaims at most 64 newly indexed,
unreferenced nodes, including children made unreachable by the bounded cascade.
Discard releases root ownership but defers graph cleanup to a later accepted
write. An existing backlog converges over later writes. The scope,
organization, managed-node flag and zero-reference index bound candidate
selection. This removes obsolete intermediate roots without deleting signed
history entries or key candidates.

Graph ownership and counts are disposable liveness hints, not authority. The
verifier still authenticates sealed progress and checks each proof against its
private root. Corrupt graph hints can prevent reclamation or lose disposable
proofs; they cannot establish a new trusted history. The existing online replay
path can repair missing proof material, while offline callers may need to retry
online. Organization reset clears graph hints together with its cached evidence.

The encrypted archive is key material, not an authorization cache; see
[key envelope candidates](principal-key-envelope-candidates.md) for its trust
boundary. Archive persistence does not authenticate the old progress record.
Corrupted local artifacts can replace useful candidates and make offline
decryption unavailable; their consistency checks do not establish a new trust
boundary.

The archive rows and stage recency hints join the same guarded transaction as
prefix publication or coupled receipt/checkpoint admission. Cancellation and
transaction failure roll back reclamation as well as the new artifacts. The
tests cover old object-key decryption after rotation, preservation of the
immediate completed predecessor, transaction rollback, scope isolation, and the
indexed SQLite query plan. Real HTTP tests reject a sequence of malformed
current payloads while retaining only eight completed attempts, preserving the
published prefix and predecessor offline, and decrypting an old object key after
its unpublished stage is evicted.

This bounds staged recovery attempts and cleanup batches, not total cache bytes.
Retained key epochs, signed entries, leaf-reference hints and the shared nodes
needed to prove them still grow with history. In
`principalHistoryNodeRetention.test.ts`, 128 successive private heads retain 133
proof nodes for the current head and predecessor, and public recovery retains
127 nodes for its single published root; every historical version remains
provable offline.
