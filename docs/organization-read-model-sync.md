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

A principal's members are users, never other principals, so a membership edit
invalidates exactly the one principal it names. This is what bounds reverse
invalidation fanout: there is no group-in-group edge for an edit to propagate
along, and no standalone or cross-organization group can widen the blast radius
of a change.

Deleted organization group IDs are never reused. Deletion writes a durable,
domain-owned group tombstone in the same transaction as the hard delete and
feed marker. Policy replay and catalog creation consult that tombstone; they do
not treat the read-model change log as authority, so future feed retention
cannot alter cryptographic or lifecycle decisions.

Protocol version 5 includes these lanes:

- `directory`: roster and profile-binding rows;
- `groups`: visible group catalog rows and state-head summaries;
- `groupMemberships`: state-hash-bound membership projections for individual
  groups, including the reserved `Members` group that is hidden from the group
  catalog;
- `grants`: a whole-lane replacement of container access presentation rows;
- `organizationPolicy`: the current organization policy head used only to
  determine whether separately verified local policy history is current.

Grant lists and group-container views filter the local grants lane. User details
are derived locally from the directory, the complete cycle-safe membership
graph, the visible group catalog, and grants. Hidden groups remain traversal and
grant inputs even though they are omitted from the displayed group list.
Container display names are joined from local encrypted metadata. Data usage
remains a separately refreshed aggregate. Organization and group policy history
may be rendered from the separately persisted, verified policy bundle only when
its principal ID, state hash, version, key epoch, key fingerprint, and member
count exactly match the corresponding read-model head. Missing or mismatched
policy state triggers one canonical verified-policy request; projected policy
heads, membership, and group metadata never become cryptographic inputs. The
feed logically retains the newest 10,000 change markers per organization.

Grant `updatedAt` is access-head time, not the container content timestamp.
Container access-manifest advancement, structural moves, and deletion replace
the grants lane; ordinary document or blob content writes do not invalidate it.
This avoids turning content sync into organization-wide grant fanout.

`upsert` and `delete` apply to entity rows. `replace` invalidates a whole
state-bound entity or lane snapshot.

## Protocol versioning

Version 5 is a clean protocol reset, not a compatibility extension. Responses
and opaque cursors carry version 5, response validation accepts only the exact
version 5 lane shapes, and the server rejects other cursor versions. Version 4
was the previous reset; group members carried `memberPrincipalType` and
`memberPrincipalId` there, and carry a single `userId` now. Local storage
contains only the current projection schema; pre-reset databases must be
discarded rather than upgraded.

There is no translation, dual-read period, or legacy directory, group,
membership, grants, group-container, user-detail, or raw principal-policy-table
fallback.

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

The client applies group summaries, membership heads, member rows, grants,
requester metadata, and the cursor in one SQLite transaction. Every stateful
visible group must have a membership head whose hash and member count match its
group summary, and the reserved `Members` head must be present. Duplicate grant
identities or a scope/binding mismatch rejects and rolls back the whole page,
including cursor advancement.

Each append prunes an older contiguous marker prefix in the same transaction as
the source mutation, while retaining the newest 10,000 markers. A cursor
immediately before the earliest retained marker can still replay every change;
an older cursor receives reset semantics and the client atomically replaces the
organization's projection from a new full snapshot. Applying the same response
more than once is a no-op. This bounds live logical feed rows; physical database
reclamation, such as PostgreSQL autovacuum or SQLite `VACUUM`, is separate
database maintenance.

Network, server, and response-shape failures retain the last-known-good local
snapshot. An authoritative 403 or 404 purges the organization's projection.

## Realtime behavior

WebSocket messages are content-free hints. A client declares
`known_organizations` only while an eligible projection consumer has demand.
Org Manager demands it while mounted; Explorer latches demand for the lifetime
of its mount after first opening container or document info so projected group
and attribution labels stay current without repeated warm-open requests. An
authenticated SDK that never opens the projection declares no organization
interest and performs no background read-model request. Interest is replaced on
scope changes, cleared when the last consumer unmounts, and re-declared on
reconnect.

Explorer presentation loaders read the SQLite projection only. They do not
reconcile as a cold-miss fallback; the latched demand catch-up above is the one
network owner and repaints consumers after the atomic projection update.
Roster and attribution display names are joined only from already-persisted
local contact summaries. Explorer and Org Manager never provision the
roster-profile container, open profile document stores, or schedule
profile-document synchronization to render the roster. A cold profile
therefore falls back to its user ID until the normal document sync path
persists that profile locally. Opening the selected profile editor remains an
explicit document operation and may synchronize that one selected profile.

Demand is exact to the authenticated domain, organization, and user scope.
Offline consumers may keep rendering their last-known-good local projection,
but they do not reconcile or declare live interest. Returning online lets the
socket interest declaration own the normal single catch-up pass. The gateway
acknowledges that declaration only after authorization and socket indexing, and
the client starts HTTP catch-up only after the matching acknowledgement. This
ordering prevents a committed feed event from falling between catch-up and
live routing. A denied acknowledgement still drives HTTP reconciliation so its
authoritative 403 or 404 response purges stale local policy and keying material.
Declaration authorization is deadline-bounded and fails closed with that same
denied acknowledgement, so one stalled access check cannot strand catch-up or
delay organization events for other connected recipients indefinitely.
If realtime remains unavailable, a bounded HTTP fallback refreshes the
projection; any later socket connection performs a fresh gap-closing pass.
Logout, database loss, and identity transitions synchronously invalidate
presentation from the previous scope.

The gateway authorizes every organization declaration against direct current
access before indexing the socket. Each internal
`organization_read_model_changed` event also carries the authoritative active
roster audience resolved after commit. The process-local router intersects that
audience with declared interest and reconstructs a minimal client frame;
recipient IDs and the authoring-session origin never cross the websocket
boundary. A malformed event or one without an audience fails closed. When a
previously authorized interested user leaves the audience, the socket receives
one access-revoked control and no subsequent mutation timing while access is
absent. HTTP reconciliation then purges the local projection on 403 or 404.

Principal-policy writes publish the container-discovery `shared_with_you` hint
only for users who become newly reachable after the commit, and only when the
changed principal holds a grant in a current container manifest, or an ancestor
*container* of one does. Existing members and ungranted group changes publish no
discovery hint. Container-ancestor traversal surfaces a real access gain without
turning every membership edit into root-container synchronization.

Every HTTP request that observes one or more marker appends retains the highest
observed cursor per organization. After the handler finishes, one batched head
and active-roster read verifies which observations actually committed and
resolves their audiences. Each committed organization publishes at most one
hint, even if a later post-commit step changed the HTTP status. Rolled-back
transactions, no-op writes, and exact policy replays publish none. Verification
and publication are best-effort: a database or broker failure cannot turn a
committed mutation into a retrying HTTP failure.

Author sockets receive the hint because one auth session can own multiple client
instances and session-wide suppression would strand siblings. The minimal frame
marks whether it came from that socket's session without exposing the session
identifier. While Org Manager itself is mutating, its own hints are held; the
explicit post-mutation feed reconciliation absorbs them when it advances the
local cursor, so correctness does not add duplicate requests. Other active
clients reconcile immediately. A synchronous burst collapses before I/O, and a
hint arriving during I/O sets one dirty bit for a sequential catch-up pass;
parallel organization feed requests are never started for one SDK scope.

Socket closure or error enters a cancellable exponential-backoff loop with
jitter. Every attempt mints a fresh one-time websocket ticket. A handshake must
remain open for ten seconds before it resets that backoff, so
accept-and-immediately-close failures cannot create a fixed-rate ticket storm.
A successful reconnect re-declares current demand and schedules one catch-up for
the mounted consumer. A declaration denied while access is absent remains
non-routable, but a later authoritative audience event triggers a fresh access
check so restored access cannot be stranded until another reconnect.
Authentication, offline, and local-only transitions tear down the loop; the
first connection still does not fetch a projection that has no consumer.

Provisioned system-container polling prefers an exact system-slot match. A
viewer of a shared organization cannot derive slots keyed by that
organization's founder, so an already-hydrated direct child of the active root
with the registered visible name and an opaque non-null slot also ends the
poll. This is only a discovery stop condition; signed container state remains
the access and keying authority.

This control event never enters the container/document event queue and schedules
only organization read-model reconciliation. HTTP remains authoritative after
hints, reconnects, explicit refreshes, and cursor-gap recovery.
