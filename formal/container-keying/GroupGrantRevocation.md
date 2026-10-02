# Group grant revocation

[`GroupGrantRevocation.tla`](./GroupGrantRevocation.tla) models issue #2365
finding 20. A container grant to a group seals the container KEK to the group
key, and those wraps are retained after the grant is revoked. An additive
member change keeps the group key, so a member added after a revocation that
did not rotate the group key could open the container history the group lost.

| Model action or predicate | Production seam |
| --- | --- |
| `Grant` / `Rotate` | `listRequiredContainerRematerializations` requires a container mutation, sealed to the group's current key, for every added or changed grant |
| `Revoke` | `getPrincipalPolicyTransitionMismatch` (`grant_removal_without_key_rotation`), enforced by the API's `validatePrincipalPolicyTransition` and the client's `verifySuccessorPrincipalPolicyChainEntry`; honest clients sign `buildGroupAccessSetShrinkPolicyRequest` |
| `AddMember` | `buildAddGroupUserPolicyRequest` keeps the group key and wraps it to the joiner |
| `RemoveMember` | `buildRemoveGroupUserPolicyRequest` rotates through `buildRotatedKeyGroupPolicyRequest` |

The checked configuration sets `RotateGroupOnGrantRemoval = TRUE`, matching
the fixed server, and `RevokedGrantUnreadableByLaterMembers` holds: while the
grant stands revoked, no group key handed to a joiner opens a retained wrap.
The negative control `group-grant-shrink-keeps-key` sets it to `FALSE`, the
server that accepted a same-epoch grant shrink, and TLC reports the violation.

This is a sibling of [KeyringReachability](./KeyringReachability.tla) rather
than an extension of it. That model tracks one container's own KEK history;
the group key is a separate epoch dimension, and adding it there would
multiply a much larger state space. Signatures, the container's own rotation
and the wraps' cryptography are outside the abstraction; the bounds are two
members and four group key epochs.
