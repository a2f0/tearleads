# Container interest authorization

[ContainerInterest.tla](./ContainerInterest.tla) models the authorization window
between a container declaration or reconnect-cache restore and indexing the
socket for hints. A cached identifier is an untrusted request for interest.
An access change invalidates both installed interests and authorization queries
that are still in flight. A closed socket cannot be indexed by a late result.

| Model action or predicate | Production implementation |
| --- | --- |
| `BeginAuthorization` | `ContainerInterestAuthorizer.authorizedIds` calls `authorizeContainerAccessWithWorkflow` |
| `ApplyAuthorization` | `ContainerInterestAuthorizer.apply` and `ContainerInterestAuthorizer.open` call `WsEventRouter.applyAuthorizedContainerInterest` |
| `RetryAuthorization` | `ContainerInterestAuthorizer.authorizedIds` retries after a generation change |
| `ChangeAccess` | `ContainerInterestAuthorizer.invalidateAccess` and `WsEventRouter.routeServerEvent` invalidate pending and indexed interests |
| `CloseSocket` | `ContainerInterestAuthorizer.close` and `WsEventRouter.close` |

The bounded model has one socket and one container, with an initial denial,
one grant, and one revocation. The container may be a descendant authorized
through the container named by an access-change event. The routing index has no
verified ancestry, so production conservatively evicts all container interests
on any access change. This causes additional HTTP reconciliation for unaffected
subscriptions, which are authorized again before indexing.

The model assumes the HTTP access workflow answers correctly at the query
snapshot, and models delivery of an access-change notification as the point at
which that change is observed by this process. Cross-process notification delay
and lost pub/sub messages are outside its boundary. Redis durability, per-socket
declaration ordering, filtered cache persistence, errors, and timeouts are covered
by runtime tests. No fairness or eventual-delivery guarantee is claimed here.

The registered negative controls remove each of the three gates independently:
authorization, access-generation invalidation, and the open-socket check.
