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

An evicted in-flight writer fails its progress compare-and-swap with
`principal_history_stage_changed`. A fresh recovery can restart from a surviving
authenticated prefix or genesis; eviction imposes no history-version cutoff.
Cancellation rolls back both page acceptance and reclamation. The indexed
selection reads only stage identifiers for the bounded deletion batch.

Stages written before scope indexing remain untouched until rewritten or reset.
Completed but unpublished stages and obsolete proof-index nodes still require
further reclamation work under #2448.

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
transaction rollback, scope isolation, and the indexed SQLite query plan.

This bounds completed-stage cleanup work, not total cache bytes. Retained key
epochs and signed proof material still grow with history; completed unpublished
progress and obsolete index nodes require further reclamation.
