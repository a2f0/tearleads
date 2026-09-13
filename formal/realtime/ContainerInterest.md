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

Production bounds retries to three attempts within one timeout budget. Tabs in
one session share identical queries and wait for different queries. A timeout
retains the raw query's slot until it settles. Declarations acknowledge the
accepted IDs even when some were refused. The client records those results and
retries after a tree change or grant notification, without a denial-driven loop.

The model assumes the signed HTTP access workflow answers correctly at the
query snapshot. Notification delivery is the point at which this process
observes a change; cross-process delay and lost pub/sub messages are outside the
boundary. `ApplyAuthorization` also removes a previously indexed child when a
fresh declaration is refused; the missed-hint recovery is exercised at runtime.
No fairness or eventual-delivery guarantee is claimed. Runtime tests
cover per-socket ordering, filtered persistence, timeouts, multi-tab sharing,
principal notifications, accepted-ID acknowledgments, and client retry races.

Negative controls remove authorization, dependency invalidation, the live-socket
guard, scoped eviction, query relevance, and principal-change notification.
Each exposes the corresponding unreadable interest, closed socket, unrelated
eviction, or unnecessary retry.
