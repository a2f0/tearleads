# Container interest authorization

[ContainerInterest.tla](./ContainerInterest.tla) models the authorization window
between a client declaration and indexing a socket. Declared IDs request
interest; they do not prove access. A late result cannot index a closed socket,
and a reconnected socket starts with no container interest: no server-side
cache restores it, so the socket's own client must declare again.

| Model action or predicate | Production implementation |
| --- | --- |
| `BeginAuthorization` | `WsEventRouter.handleClientMessage` parses the socket's own `known_containers` frame; `ContainerInterestAuthorizer.apply` queues it and `ContainerInterestQueries.run` calls `authorizeContainerAccessWithWorkflow` |
| `Dependencies` | `ContainerInterestDependencies` indexes verified container paths and principal policies |
| `ApplyAuthorization` | `ContainerInterestAuthorizer.apply` calls `WsEventRouter.applyAuthorizedContainerInterest` synchronously within the query observation window, then sends `known_containers_ack` |
| `QuerySocketOpen` | `ContainerInterestAuthorizer.isOpen` checks the query's own socket object, so another socket of the session cannot receive its result |
| `SettleOrphanedAuthorization` | A closed socket's query settles; `ContainerInterestAuthorizer.enqueue` drops its install because the socket has no state |
| `ReopenSocket` | A fresh-ticket upgrade calls `ContainerInterestAuthorizer.open` and `WsEventRouter.open`, which start the socket with an empty interest set and send no frame |
| `RetryAuthorization` | `authorizationWasInvalidated` checks requested IDs and accepted proof dependencies |
| `ChangeAccess` | Container mutation and principal policy routes publish invalidations; `ContainerInterestAuthorizer.invalidateAccess` and `WsEventRouter.routeServerEvent` observe them |
| `CloseSocket` | `ContainerInterestAuthorizer.close` and `WsEventRouter.close` |
| `UndeclaredSocketsReceiveNoHints` | `WsEventRouter.routeHint` reaches only sockets indexed by their own authorized declaration |
| `EndSession` | `destroyUserSession` publishes `session_revoked` once through `createSessionRevocationNotifier`, and `WsEventRouter.closeSession` closes the session's sockets if it arrives; expiry publishes nothing |
| `ReadSession` | Each session's own `RevalidationSchedule` tick in `WsSessionLiveness`, and every `addSubscriberReconnectListener` pass through `WsSessionLiveness.checkAll` (16 sessions at a time), reads `isLiveUserSession` once per session. A check joins a read already in flight and waits at most `sessionReadTimeoutMs`; only a live answer reaches `WsSessionLiveness.confirm` |
| `CompletePass` | The read's own continuation in `WsSessionLiveness.startRead` calls `WsEventRouter.closeSession` for an ended session, even when its check already timed out |
| `Elapse` | Time as read by `ProofAgePolicy.now` |
| `SessionDeadline` | `WsSessionLiveness.confirm` arms one deadline per session at the last confirmation plus `maxProofAgeMs`; when it fires, `WsEventRouter.closeSession` closes the session's sockets with `SESSION_UNVERIFIED_CLOSE` |
| `EndedSessionsCloseByNextPass` | `WsEventRouter.closeSession` closes an ended session's sockets with `SESSION_ENDED_CLOSE` once a read the store answers after the end completes |
| `UnconfirmedSessionsLapse` | A failed or timed-out read neither reaches `WsSessionLiveness.confirm` nor moves the session deadline |
| (boundary assumption) lost pub/sub delivery | `ContainerInterestAuthorizer.revalidate` re-verifies installed proofs on each socket's jittered `RevalidationSchedule` interval and on every subscriber reconnect via `addSubscriberReconnectListener` |

The bounded model has a child subscription that depends on its root and a group
policy, plus an independent subscription belonging to another socket. A change
to an ancestor or the group invalidates the child; an unrelated change must
preserve both subscriptions. A pending query captures read access and records
changes. Accepted results depend on their verified paths and policies. Denied
results retry only changes to the requested ID, since they have no verified
path. An unrelated mutation must never consume that query's retry budget. The
socket may close and its client reconnect on a fresh ticket for the same live
session; the new socket indexes "child" only after its own declaration, even
while a query from the closed socket is still pending.

Production bounds retries to three attempts within one timeout budget, scaled
to one base interval per 100 requested IDs, capped at six intervals (60 seconds
in production). Each socket retains at most 32 pending operations and 20,000
declared IDs, including active work. Overflow closes the socket and makes its
queued operations inert; runtime flood tests cover both limits. This uses the
model's existing `CloseSocket` transition rather than modeling queue capacity.
Tabs in one session share identical queries and wait for different queries. A timeout
retains the raw query's slot until it settles. The separate 10,000-change
observation cap may reject a query during a pub/sub flood; that availability
limit is outside this bounded two-change model. Declarations acknowledge the
accepted IDs even when some were refused. Every declaration, including the first
full declaration after a reconnect, runs its own authorization; a socket opens
with no interest and nothing is cached for it. The client records those results
and retries after a tree change or grant notification, without a denial-driven
loop.

The model assumes the signed HTTP access workflow answers correctly at the
query snapshot. Notification delivery is the point at which this process
observes a change; cross-process delay and lost pub/sub messages are outside the
boundary. `ApplyAuthorization` also removes a previously indexed child when a
fresh declaration is refused; the missed-hint recovery is exercised at runtime.
No fairness or eventual-delivery guarantee is claimed here. Hints published
while a reconnecting client holds no interest are recovered by the client, not
the router: the acknowledgement of its first declaration advances the
connection generation and the client then reconciles over HTTP.
[RestartProbeConvergence](../document-sync/RestartProbeConvergence.md) checks
that barrier: opening the socket is not readiness, and the acknowledgement arms
a probe that covers every version committed before it. Runtime tests cover
per-socket ordering, timeouts, multi-tab sharing, principal notifications,
accepted-ID acknowledgments, an undeclared socket receiving no hint, and client
retry races.

Production bounds the lost-message window the model leaves open. Pub/sub is
at-most-once, so an `access_changed` published during a subscriber outage never
arrives. Each socket re-runs the same signed batch verification over its
installed proofs on a jittered interval (five minutes by default), evicting
refusals with `resync_required` exactly as an observed change would, and a
subscriber reconnect re-verifies every live socket immediately while asking each
client to resync everything it holds; the subscriber's first held subscription
counts as such a reconnect, so sockets opened while that subscription was still
pending catch up on the hints published before it. That resync request is held
per socket until a verification succeeds, so a failed pass cannot discard it.
Verification failures never extend the bound: each socket records when a full
verification last confirmed its installed proofs and arms a
per-socket deadline timer at exactly `verifiedAt + maxProofAgeMs` (three
intervals, fifteen minutes by default). If no verification completes before it
fires, every subscription is evicted with one `resync_required`, whether the
pass that would have confirmed them failed, is queued behind slow declarations,
is in flight, or could not be enqueued at all; the jittered ticks only attempt
verification and never gate the bound. Each eviction advances a per-socket
epoch, so a pass that started earlier discards its result instead of
reinstalling the evicted ids, and marks the session's running authorization
query stale, so a declaration whose query straddles the deadline re-authorizes
instead of installing the older answer; and a reconnect discards any pass in
flight (its proofs may predate the outage) before starting a fresh one that
carries the resync. A socket holding no interest receives `shared_with_you` on
reconnect so a share granted during the outage is still discovered, and a
reconnect marks every running authorization query stale so neither a fresh pass
nor a reader already waiting on it installs an answer read before the outage;
both re-query (a timed-out query is marked stale the same way). The client
answers a reconnect resync by re-listing each held container's parent lane and
own child lane, so a child created during the outage surfaces. A lost
invalidation therefore leaves a revoked subscription live for at most one
interval while verification succeeds and at most exactly `maxProofAgeMs` after
the last confirmation otherwise, never the socket lifetime. Organization purges
publish per-container invalidations for the deleted rows. Only revoke, move, and
delete evict; grants, rekeys, and recites do not remove readers and route their
hints without evicting descendant subscribers, and the client drops its cached
writer projections for the hinted container and its locally known descendants on
that hint so their next share or move fetches a fresh manifest instead of
conflicting; document writer projections cite the same paths, and since the
client cannot list a container's linked documents locally it drops every cached
document projection (the api-client cache and each open document's in-memory
copy) as well. Because a hint routes only to watchers of the mutated container
and its parents, the gateway also sends each subscriber whose verified path
cites the mutated container a `container_path_changed` hint naming those held
containers; it evicts nothing, so a subtree granted directly at a descendant
drops its cached projections without losing its subscriptions. The eviction is
published before the hint so the evicted socket never receives child details
from that hint. Its `resync_required` frame names previously held ids and drops
their cached subtree projections and open document projections before HTTP
revalidation. A remaining parent subscription receives only a generic child-list
refresh.

Hint frames are scoped per recipient: the router rebuilds each frame with only
the container ids that socket holds verified interest in (a document hint's
linked containers, a directly held container hint's parent and previous parent).
Parent-only recipients instead receive `container_children_changed` naming only
the parent ids they hold, with no child id, event type, or mutation timestamp.
The SDK clears cached projections under those parents and refreshes their
listings plus root, including children whose interest is still unconfirmed.
See [Realtime hint privacy](../../docs/developer/realtime-hints.md) for the wire
contract and the remaining traffic-timing disclosure.

Revocation frames batch affected IDs per socket. The app queues each affected
container once and refreshes root plus distinct parent lanes once per batch;
runtime tests cover this cardinality rather than the model.
While a declaration round awaits acknowledgment, the client coalesces tree
changes and sends one diff from the latest snapshot after that round completes.
Burst tests cover both initial declarations and later add/remove rounds.
The accepted-ID acknowledgment and batched revocation frames are a flag-day
wire contract.

Only group policy changes affect container reachability. Organization policy
constraints prohibit grants and require their projection to mirror the current
Admins group. Creating/deleting an ungranted group changes that directory, not
read access. Group deletion also rejects built-in groups and current container
grants, and principals contain only direct users (no nested group edges).
Roster updates only replace a profile-document pointer. These guards live in
`principalPolicyAuthorityConstraints.ts`, `groupDeletion.ts`, and
`rosterMutation.ts`; those operations need no interest invalidation.

A socket's session is checked once, at upgrade. Revocation publishes
`session_revoked` at most once, and expiry publishes nothing, so `EndSession`
may leave the socket open and indexed. Each session therefore has its own
jittered recheck, one store read per interval however many sockets it holds,
and every subscriber reconnect rechecks each open session once, 16 sessions
at a time. An ended session's sockets close. The model splits a pass into
the store read and the close: a session that ends between them is served until
the next read the store answers, so `EndedSessionsCloseByNextPass` holds for
every pass whose read follows the end. The recheck runs beside proof
re-verification, not ahead of it, so a reconnect still marks the outage's
queries stale at once; a pass that re-verifies a socket while its session read
is pending cannot install proofs after the close, since installs require an
open socket. The model checks only the session recheck; proof re-verification
stays the boundary assumption above.

The session store may fail or hang through the same outage. A check waits at
most `sessionReadTimeoutMs` (ten seconds) and reports once per pass under its
own diagnostic label. A read that times out stays outstanding, but a later
check joins it instead of adding another, so a hung store holds at most one
read per session. The deadline then closes the session even if that read never
answers. A read that
answers late still acts on its answer. A failure only delays the close, up to a
deadline: like installed proofs, a session the store has not confirmed for
`maxProofAgeMs` closes every socket with 1013, so the client reconnects through
a fresh ticket once the store answers again. The bound must be at least twice
the revalidation interval: a tick can come a whole interval after the last one,
and a confirmation dates from when its read started. A shorter bound is refused
at startup. Only a live answer, or a ticket
upgrade for another socket of the session, confirms it and re-arms the
deadline. `Elapse` advances time while the socket is open, and
`UnconfirmedSessionsLapse` checks that no socket is served once its session has
gone unconfirmed past the deadline, however many reads fail. With rechecks
disabled (`intervalMs` 0) a session is checked only on reconnect and has no
deadline.

Negative controls remove authorization, dependency invalidation, the live-socket
guard, the per-socket ownership of a query result, scoped eviction, query
relevance, principal-change notification, the session recheck, the session
deadline, and the rule that only a live answer confirms a session. Each exposes
the corresponding unreadable interest, closed socket, undeclared reconnected
socket, unrelated eviction, unnecessary retry, ended session served past a pass,
or unconfirmed session served past its deadline.
