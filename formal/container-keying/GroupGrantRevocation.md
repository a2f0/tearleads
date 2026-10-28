# Group grant revocation

[`GroupGrantRevocation.tla`](./GroupGrantRevocation.tla) models group policy
changes and the container batches they commit with. A container grant to a
group seals the container KEK to the group key, and those wraps are retained
after the grant is revoked. An additive member change keeps the group key, so
a member added after a revocation that did not rotate the group key could open
the container history the group lost.

Every group policy change commits in one transaction with a container mutation
for each container the group is granted. The model's admin device plans that
batch from the container heads it read, while other devices may share the same
containers directly before it submits.

| Model action or predicate | Production seam |
| --- | --- |
| `Request` / `Batch` | `preparePrincipalContainerRematerializationBatch` plans an entry for every grant in the group's signed policy; `listRequiredContainerRematerializations` requires a rekey, reference refresh, or revoke for every container the group is or was granted |
| `Rotates` | `getPrincipalPolicyTransitionMismatch` (`grant_removal_without_key_rotation`), enforced by the API's `validatePrincipalPolicyTransition` and the client's `verifySuccessorPrincipalPolicyChainEntry`; `buildRemoveGroupUserPolicyRequest` rotates through `buildRotatedKeyGroupPolicyRequest`; `buildAddGroupUserPolicyRequest` keeps the key and wraps it to the joiner |
| `Apply` | `putPrincipalPolicy` holds the group-reference lock and runs `applyPrincipalContainerRematerializations` in the same transaction, so the policy successor and its batch commit together or not at all |
| `RequireEveryRematerialization` / `IncompleteRotation` | `rematerializationInputs` refuses a batch missing a required entry ("must rematerialize every stale container grant"), and `applyPrincipalContainerRematerializations` checks again after the batch applies |
| `DirectShare` / `RefuseStaleHead` | a concurrent container mutation from another device; `assertMutationHeadCanAdvance` and `assertManifestHeadCurrent` refuse an entry citing a superseded own or ancestor head with `container_mutation_state_stale`, which `principalPolicyErrorFromContainerMutation` keeps on the policy error |
| `ReplanOnStale` | `submitGroupPolicyCommit` answers one coded stale refusal by calling `refreshAfterConflict`, which evicts the cached projections and plans again from served heads; a second refusal fails with "Group policy update failed" |
| `CiteAuthoredParentHead` | `planRematerializationTarget` records every path the batch authors in `authoredAbove`, and `rerootOnAuthoredPaths` re-roots each later entry on the deepest one (#2652) |
| `Retry` | `commitCurrentGroupPolicyMutation` reports the failure to its caller; the person runs the change again, and nothing retries it automatically |

## Properties

`RevokedGrantUnreadableByLaterMembers` holds: while a grant stands revoked, no
group key handed to a joiner opens a retained wrap.
`LiveGrantsOpenToCurrentGroupKey` holds: every container the group still holds
is sealed to the current group key, the only one a joiner receives.
`DirectSharesSurvive` holds: no batch entry replaces a head another device
advanced. `FailureNeedsRepeatedRaces` holds: a change fails only after two
concurrent shares each staled one of its two attempts.
`RequestedChangeCommits` holds under weak fairness of the admin device's submit
and the person's retry, with concurrent shares bounded; no other device has to
act.

The bounds are two members, a root container with one child, three group key
epochs, and two concurrent shares. The run explores 76,638 generated and
28,312 distinct states.

## Negative controls

Each control flips one guard in
[`protocolGroupGrantRevocationNegativeControls.ts`](../../scripts/protocol/protocolGroupGrantRevocationNegativeControls.ts):

- `RotateGroupOnGrantRemoval = FALSE` violates
  `RevokedGrantUnreadableByLaterMembers`: a server that accepts a same-epoch
  grant shrink hands a joiner the retained key.
- `RequireEveryRematerialization = FALSE` violates
  `LiveGrantsOpenToCurrentGroupKey`: a rotation that skips a granted container
  leaves it sealed only to keys a joiner never receives.
- `RefuseStaleHead = FALSE` violates `DirectSharesSurvive`: an entry planned
  before another device's share overwrites it.
- `ReplanOnStale = FALSE` violates `FailureNeedsRepeatedRaces`: one direct
  share fails the change (#2654).
- `CiteAuthoredParentHead = FALSE` violates `FailureNeedsRepeatedRaces`: a
  batch granting both containers is refused with no race at all, and every
  retry is refused the same way (#2651).

## Boundary

One admin device changes the group, and `IncompleteRotation` stands in for any
other client that signs an incomplete batch. Two admins changing the same
group conflict on the group policy head instead, which this model does not
cover. Compound enrollment, a member batch committed with the group batch, is
outside the model; `submitGroupPolicyCommit` refuses it atomically rather than
replanning. Descendant rekeys a rotation must carry are covered by
[InaccessibleIntermediateRepair](./InaccessibleIntermediateRepair.md).

This is a sibling of [KeyringReachability](./KeyringReachability.tla) rather
than an extension of it. That model tracks one container's own KEK history;
the group key is a separate epoch dimension, and adding it there would
multiply a much larger state space. Signatures, the container's own rotation
and the wraps' cryptography are outside the abstraction.
