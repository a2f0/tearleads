# Container interest authorization

[ContainerInterest.tla](./ContainerInterest.tla) models the authorization window
between a declaration or reconnect-cache restore and indexing a socket. Cached
IDs request interest; they do not prove access. A late result cannot index a
closed socket.

| Model action or predicate | Production implementation |
| --- | --- |
| `BeginAuthorization` | `ContainerInterestQueries.run` calls `authorizeContainerAccessWithWorkflow` |
| `Dependencies` | `ContainerInterestDependencies` indexes verified container paths and principal policies |
| `ApplyAuthorization` | `ContainerInterestAuthorizer.apply` and `ContainerInterestAuthorizer.open` call `WsEventRouter.applyAuthorizedContainerInterest` synchronously within the query observation window |
| `ReuseRestoredAuthorization` | `ContainerInterestRestoration.take` checks observed dependency changes for its one-time proof handoff |
| `RetryAuthorization` | `authorizationWasInvalidated` checks requested IDs and accepted proof dependencies |
| `ChangeAccess` | Container mutation and principal policy routes publish invalidations; `ContainerInterestAuthorizer.invalidateAccess` and `WsEventRouter.routeServerEvent` observe them |
| `CloseSocket` | `ContainerInterestAuthorizer.close` and `WsEventRouter.close` |
| (boundary assumption) lost pub/sub delivery | `ContainerInterestAuthorizer.revalidate` re-verifies installed proofs on the jittered `ContainerInterestRevalidationSchedule` interval and on every subscriber reconnect via `addSubscriberReconnectListener` |

The bounded model has a child subscription that depends on its root and a group
policy, plus an independent subscription belonging to another socket. A change
to an ancestor or the group invalidates the child; an unrelated change must
preserve both subscriptions. A pending query captures read access and records
changes. Accepted results depend on their verified paths and policies. Denied
results retry only changes to the requested ID, since they have no verified
path. An unrelated mutation must never consume that query's retry budget.

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
accepted IDs even when some were refused. A failed cache load or authorization
returns an empty live baseline. A matching first full declaration can reuse the
freshly checked result once, within its timeout window and before any observed
dependency change; later declarations reauthorize. The client records those
results and retries after a tree change or grant notification, without a
denial-driven loop.

The model assumes the signed HTTP access workflow answers correctly at the
query snapshot. Notification delivery is the point at which this process
observes a change; cross-process delay and lost pub/sub messages are outside the
boundary. `ApplyAuthorization` also removes a previously indexed child when a
fresh declaration is refused; the missed-hint recovery is exercised at runtime.
No fairness or eventual-delivery guarantee is claimed. Runtime tests
cover per-socket ordering, filtered persistence, timeouts, multi-tab sharing,
principal notifications, accepted-ID acknowledgments, and client retry races.

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
The reconnect proof handoff is cleared the moment a reconnect pass begins and
again by every successful pass, so a matching declaration reauthorizes instead
of reinstalling a proof verified before the outage or an evicted one, even when
the fresh pass fails. Verification failures never extend the bound: each socket
records when a full verification last confirmed its installed proofs and arms a
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
conflicting. Because a hint routes only to watchers of the mutated container and
its parents, the gateway also sends each subscriber whose verified path cites
the mutated container a `container_path_changed` hint naming those held
containers; it evicts nothing, so a subtree granted directly at a descendant
drops its cached projections without losing its subscriptions. The eviction is
published before the hint so the evicted socket never receives it.

Hint frames are scoped per recipient: the router rebuilds each frame with only
the container ids that socket holds verified interest in (a document hint's
linked containers, a container hint's parent and previous parent), so a watcher
of one side of a move never learns the other side.

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

Negative controls remove authorization, dependency invalidation, the live-socket
guard, scoped eviction, query relevance, principal-change notification, and the
reconnect proof dependency guard.
Each exposes the corresponding unreadable interest, closed socket, unrelated
eviction, or unnecessary retry.
