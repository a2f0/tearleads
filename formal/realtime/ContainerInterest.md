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

Revocation frames batch affected IDs per socket. The app queues each affected
container once and refreshes root plus distinct parent lanes once per batch;
runtime tests cover this cardinality rather than the model.

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
