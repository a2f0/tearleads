# Organization Read-Model Sync

Organization administration is server-authoritative but should be local-first
for presentation. The client therefore keeps normalized SQLite projections and
reconciles them from one organization-scoped, ordered change feed.

## Authority boundary

The read model contains display and navigation data. It is not an authorization
or cryptographic input. Signed principal policies, verified access manifests,
wrapped key envelopes, and anti-rollback checkpoints remain authoritative.

The signed organization-policy payload carries an immutable versioned
authority descriptor binding the organization to its reserved `Admins` and
`Members` group IDs. Provisioning and later organization-policy writes must
match those IDs. The reserved `Admins` policy contains direct `admin` users
only, so clients can verify its complete chain without consulting roster or
group-catalog projections.

Every signed principal-state header has an `externalAuthority` field. Directly
authorized states use `null`; externally administered organization groups cite
the exact signed Admins head used to authorize that state. Historical citations
are checked against exact signed Admins history, while child successors newer
than a local checkpoint must cite the currently verified Admins head. This
contract has no legacy fallback: pre-contract state requires reset and
reprovisioning rather than translation.

Explorer writes must obtain the exact verified policy and access state needed
to unwrap keys and encrypt content. They must never infer authority from a
cached roster, membership, grant, or administrator row. Verified policy data
may enrich the UI projection; the UI projection never feeds keying decisions.
The local membership tables bind each projected roster to a principal-state
hash, but that binding is a projection-integrity check, not a substitute for
verifying the signed principal policy.

The projection and verified policy tables may share a physical SQLite database,
but they use separate types, persistence modules, and dependency paths.
Requester-relative fields such as `currentUser.isOrgAdmin` and `isSelf` are
session metadata. Clients derive or hold them outside organization-global rows.
Every feed response carries `currentUser` at the top level, even when no lane
changed, so one identity advancing the shared cursor cannot strand another
identity's requester state.

## Ordering and replay

Every authoritative mutation that changes an organization read model locks and
increments its `organization_read_model_heads` row, then appends an
`organization_read_model_changes` row in the same database transaction. The
counter is per organization and rolls back with the mutation. Same-organization
writers are serialized, so cursor allocation order is commit order. Clients
treat cursor values as opaque strings.

A global database sequence is intentionally not used. Postgres sequences are
allocation-ordered and do not roll back: a transaction could reserve cursor 10,
another commit cursor 11, and a client could advance past the later-committing
10. A transactional organization head removes that race.

Mutation workflows append only after actual domain transitions. Exact policy
replays and no-op conditional updates do not append markers. The log itself is
at-least-once: duplicate invalidations are safe because projection application
is idempotent, and avoiding source-based deduplication preserves legitimate
temporal transitions such as A to B to A.

Organization-scoped policies may reference only groups owned by that same
organization. This preserves the bootstrap `Members` to `Admins` nesting while
preventing standalone or cross-organization groups from creating unbounded
reverse invalidation fanout. Generic standalone principal policies retain their
independent nested-group behavior.

Deleted organization group IDs are never reused. Deletion writes a durable,
domain-owned group tombstone in the same transaction as the hard delete and
feed marker. Policy replay and catalog creation consult that tombstone; they do
not treat the read-model change log as authority, so future feed retention
cannot alter cryptographic or lifecycle decisions.

Protocol version 2 includes these lanes:

- `directory`: roster and profile-binding rows;
- `groups`: visible group catalog rows and state-head summaries;
- `groupMemberships`: state-hash-bound membership projections for individual
  groups, including the reserved `Members` group that is hidden from the group
  catalog.

Container grants, data usage, user details, and policy history remain
request-driven until their response shapes and mutation coverage ship end to
end. Realtime hints and feed retention/compaction are also deferred. A client
must never advance a cursor past data it cannot apply, so each future persisted
shape must arrive as a new strict lane or another explicit protocol reset.

`upsert` and `delete` apply to entity rows. `replace` invalidates a whole
state-bound entity or lane snapshot.

## Protocol versioning

Version 2 is a clean protocol reset, not a compatibility extension. Responses
and opaque cursors carry version 2, response validation accepts only the exact
version 2 lane shapes, and the server rejects version 1 cursors. A client that
finds a persisted version 1 organization projection atomically deletes that
disposable projection and reconciles again without a cursor to obtain a full
version 2 snapshot.

There is no version 1 to version 2 translation, dual-read period, or legacy
directory/group fallback. Request-driven organization views that have not yet
moved into the feed are current APIs, not compatibility shims.

## Snapshot and delta contract

A client without a cursor requests an atomic full snapshot. A client with a
cursor requests ordered changes after that cursor. Responses include an opaque
`nextCursor`, `hasMore`, and unconditional requester metadata; the client
advances its cursor and requester row in the same local SQLite transaction that
applies the page. A concurrent response already applied at the same cursor may
still update its own requester row. A stale response updates neither.

A snapshot carries a membership head for the reserved `Members` group and for
every stateful visible group, including groups with no members. Each head
contains the complete ordered member list and the exact principal-state hash;
snapshot `deletedGroupIds` is empty. A membership delta is entity-level rather
than a member patch: `groups` contains the complete replacement for each changed
group, while `deletedGroupIds` removes groups whose final coalesced operation is
deletion. Unchanged memberships are omitted.

The client applies group summaries, membership heads, member rows, requester
metadata, and the cursor in one SQLite transaction. Every stateful visible
group must have a membership head whose hash and member count match its group
summary, and the reserved `Members` head must be present. A mismatch rejects and
rolls back the whole page, including cursor advancement.

Retention is disabled in the first slice. Once compaction is introduced, a
cursor that predates retained history returns reset semantics and the client
atomically replaces the organization's projection from a new full snapshot.
Applying the same response more than once is a no-op.

Network, server, and response-shape failures retain the last-known-good local
snapshot. An authoritative 403 or 404 purges the organization's projection.

## Realtime behavior

WebSocket messages are content-free hints. An organization read-model hint may
schedule reconciliation only for that organization and lane; it must not start
container or document reconciliation. HTTP remains authoritative after hints,
reconnects, explicit refreshes, and cursor-gap recovery.
