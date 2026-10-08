# Document purge verification

Document purge is a signed terminal event committing the document head and sole
authorizing container head. Its signer must have write access through that
path. The API retains evidence after deletion. Full history requires a prior
signed-head observation by that caller. A coded not-found response only prompts
proof fetching; deletion requires an exact local document pin or every signed
transition from a pin or signed genesis. A hash-only snapshot cannot advance a
checkpoint. A later pinned head anywhere on the authorizing path, including an
ancestor, leaves purge ordering unavailable: ancestry cannot order the separate
purge signature relative to that later head. The client authenticates the proof
and checks document, policy, and visible container forks before classifying this
as `ProjectionDependencyUnavailableError`. It retains local data without an
integrity incident or an automatic sync retry loop. Currency is checked again
inside the atomic local-deletion transaction, so a racing checkpoint advance
rolls back teardown. Actual invalid signatures and conflicting checkpoints remain
integrity errors. The retained purge-time proof alone cannot resolve this ordering
ambiguity; eventual deletion after a later path checkpoint is not guaranteed.

Principal dependencies use compact `policyEvidence` sources and signed directory
payloads. A source is capped at the exact historical citation and its first
signed directory binding, including the required Admins head. Every page checks
the original purge path, organization, document and reader. A reader authorized
at purge time can recover after later revocation or deletion of the group or
container; later directory heads do not enlarge that terminal grant.

The SDK authenticates each history page using private local recovery custody.
`historicalProof` recovery retains evidence for checkpoint comparison but defers
that comparison until every purge artifact has authenticated. Baseline recovery
never advances trust. The complete terminal commit can admit its exact bound
sources; a newer cached prefix can prove ancestry but cannot make the purge pin
that newer head. Existing newer pins are preserved only with a verified
connection. When a local pin is newer, the SDK requests a bounded ancestry
connection through `resolveReference` with `preferLocalHistory: true`. It first
uses privately authenticated local history, including after current membership
is revoked. If that evidence was lost, the ordinary authorized page endpoint
can rebuild it. These connections never extend terminal grants or advance pins.
Without an available verified connection, deletion remains pending.

Nested purge commits register their identity/database lifetime with the outer
SQLite transaction. The guard runs synchronously at COMMIT dispatch, including
when the outer transaction performs local teardown after proof verification.
Guard failure rolls back both trust records and document deletion and preserves
the cancellation error identity. Rolling back a nested savepoint also releases
its own guards while preserving the enclosing guards. Full snapshot helpers
remain test utilities;
production purge authorization and responses use bounded principal selections.
