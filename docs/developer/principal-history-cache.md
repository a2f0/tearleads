# Principal-history cache retention

Completed-prefix publication and atomic current acknowledgements reclaim older
completed stages in the same transaction.
Each pass retains the two newest completed stages through the published head and
deletes at most 16 older rows. It preserves newer, incomplete, other-scope and
other-organization progress. The scope index bounds candidate selection without
sorting all stored stages. Scope and recency records are eviction hints; only
private authentication permits recovery reuse.

Encrypted member envelopes are retained separately for each principal key
fingerprint before progress is removed. Candidate retention checks the envelope
commitment and never grants authorization. Newer envelopes for the same key
replace older candidates; key rotation retains the old key's candidates. Current
prefixes and the most recent completed predecessor remain available offline.
An older evicted exact private head can require an online replay, while signed
historical reference proofs and old key envelopes remain available. Organization
reset removes the envelope archive and eviction hints along with its other cache
material, preserving durable trust pins.

Each accepted page also reclaims abandoned incomplete progress in its own scope.
It keeps the current writer and the seven most recently touched other incomplete
stages; a completed writer may keep eight incomplete stages. A pass removes at
most 16 rows, so an existing excess converges over subsequent page writes. It
never removes completed artifacts, other scopes or other organizations through
this path. Recency hints do not authorize recovery.

Completed acceptance also targets eight indexed completed stages per scope.
It always protects the current writer and the two newest completed heads through
the published prefix, then fills the remaining slots by recency. At most 16
excess stages are removed per pass, so an existing backlog converges over later
completed writes. This runs before current-artifact verification can fail;
invalid current payloads cannot accumulate unlimited completed attempts while
the last good prefix remains unchanged. Published offline evidence, incomplete
work, other scopes and other organizations remain protected. Stale completion
or version hints are skipped rather than used to evict a different actual row.
Encrypted key candidates are archived before the bounded batch is deleted.

An evicted in-flight writer fails its progress compare-and-swap with
`principal_history_stage_changed`; the caller must start another recovery, which
can resume from a surviving authenticated prefix or genesis. The built-in runtime
serializes recovery within an organization; custom hosts with overlapping calls
must handle this retry. Eviction imposes no history-version cutoff.
Cancellation rolls back page acceptance, key archival and reclamation. Incomplete
cleanup reads only stage identifiers; completed cleanup reads current artifacts
only for its bounded archival/deletion batch. Both use the scoped recency index.

Stages written before scope indexing remain untouched until rewritten or reset.
Obsolete proof-index nodes still require reclamation work under #2448.

The encrypted archive is key material, not an authorization cache. Its candidates
can only open wraps addressed to the caller's private keys; projection and policy
verification still establish authority independently. Duplicate encoded candidates
from the archive, prefix and stage sources are tried only once.
Archive persistence does not authenticate the old progress record. Corrupted local
artifacts can replace useful candidates and make offline decryption unavailable;
their consistency checks do not establish a new trust boundary.

The archive and scope rows join the same guarded transaction as prefix publication
or coupled receipt/checkpoint admission. Cancellation and transaction failure roll
back reclamation as well as the new artifacts. The tests cover old object-key
decryption after rotation, preservation of the immediate completed predecessor,
transaction rollback, scope isolation, and the indexed SQLite query plan. Real
HTTP tests reject a sequence of malformed current payloads while retaining only
eight completed attempts, preserving the published prefix and predecessor
offline, and decrypting an old object key after its unpublished stage is evicted.

This bounds staged recovery attempts and cleanup batches, not total cache bytes.
Retained key epochs and signed proof material still grow with history; obsolete
index nodes require further reclamation.
