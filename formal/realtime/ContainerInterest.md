# Container interest authorization

[ContainerInterest.tla](./ContainerInterest.tla) models the authorization window
between a container declaration or reconnect-cache restore and indexing the
socket for hints. A cached identifier is an untrusted request for interest.
An access change invalidates both installed interests and authorization queries
that are still in flight. A closed socket cannot be indexed by a late result.

| Model action or predicate | Production implementation |
| --- | --- |
| `BeginAuthorization` | `ContainerInterestQueries.run` calls `authorizeContainerAccessWithWorkflow` |
| `ApplyAuthorization` | `ContainerInterestAuthorizer.apply` and `ContainerInterestAuthorizer.open` call `WsEventRouter.applyAuthorizedContainerInterest` |
| `RetryAuthorization` | `ContainerInterestQueries.run` retries after a relevant path change |
| `ChangeAccess` | `ContainerInterestAuthorizer.invalidateAccess` and `WsEventRouter.routeServerEvent` invalidate pending and indexed interests |
| `CloseSocket` | `ContainerInterestAuthorizer.close` and `WsEventRouter.close` |

The bounded model has one pending socket and one container, with an initial
denial, one grant, and one revocation. The container may be a descendant
authorized through the container named by an access-change event. A second,
independent subscription represents an unrelated tenant; `ScopeInvalidation`
keeps it installed when the first container changes. Production indexes the
verified path of each subscription with `ContainerInterestDependencies`.
Pending queries record changes until synchronous installation and retry when a
returned path changes or a denial might have become a grant. Retries stop after
three attempts within one timeout budget. Tabs sharing a session share identical
queries and wait for different queries; a timed-out raw query retains its slot
until it actually settles.

The model assumes the HTTP access workflow answers correctly at the query
snapshot, and models delivery of an access-change notification as the point at
which that change is observed by this process. Cross-process notification delay
and lost pub/sub messages are outside its boundary. Redis durability, per-socket
declaration ordering, filtered cache persistence, errors, and timeouts are covered
by runtime tests. No fairness or eventual-delivery guarantee is claimed here.

The registered negative controls remove each of the four gates independently:
authorization, dependency invalidation, the open-socket check, and scoped eviction.
Runtime tests also cover filtered declarations, descendant eviction, unrelated
changes during queries, and the per-session raw-query limit across reconnects.
