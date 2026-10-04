# Repair below an inaccessible stale intermediate

[`InaccessibleIntermediateRepair.tla`](./InaccessibleIntermediateRepair.tla)
covers finding 1 in #2340. On a path root → mid → leaf, a root rotation would
leave `mid` pinned to the retired root epoch. A writer whose only grant is on
`leaf` cannot re-key `mid`, and must not be given its key. The model shows that
the writer's writes nevertheless never depend on another device.

| Model action or predicate | Production seam |
| --- | --- |
| `RotateRoot`, `AuthorizedRotateRoot` | `assertGrantedPathsCurrentBelow` refuses stale granted paths; `assertDescendantRekeysWritable` checks a standalone revoker's retained authority; `planCarriedDescendantRekeys` signs the rekeys |
| `WriteAccepts` | `assertContainerKekPathCurrent` in the SDK before any new ciphertext, and `assertContainerKekParentEdgesCurrent` in the API at commit |
| `WriterRepairLeaf` | `buildAutomaticContainerRekeys` re-keys the writer's own container below a current parent, wrapping to the parent public key from `getParentWrappingPublicKey` |
| `OtherMemberRepairsMid` | `prepareAutomaticContainerRekeys` on a device whose signer has write access at the stale level |
| `WriterWrites` | `prepareAutomaticContainerRekeys` returns a plan only for a current path; otherwise `ContainerKekRepairInaccessibleError` parks the pass |
| `WriterHoldsOnlyGrantedKeys` | `requireContainerPathUserAccess` authorizes a container rekey over the root-to-target path only, so a grant further down never reaches an ancestor |

`RotateRoot` is a revocation: the revoked member keeps every root epoch minted
so far. `RevokedReachesMid` and `RevokedReachesLeaf` close that set over parent
wraps and sealed keyrings, which is what makes a stale intermediate dangerous:
its key is still reachable even though the root moved on.

Fairness follows [`NoBrickedDevice`](./NoBrickedDevice.md): only the blocked
writer's own step, `WriterRepairLeaf`, is fair. `OtherMemberRepairsMid` may
happen but nothing may depend on it. `WriterEventuallyUnblocked` therefore holds
only because `RotateRoot` re-keys `mid` in the same step. The rotator must retain
write authority on `mid` after the rotation. `leaf` is never part of that
step: it is the writer's own to repair. Setting `RotationCarriesRepairs = FALSE`
is a rotation that commits alone, and the writer is parked for good on every
behavior where no other member writes beneath `mid` again. A best-effort repair
by the rotating device afterwards would not change that verdict.

`RotatorRetainsAccess = FALSE` models a self-revoke that removes its signer's
last write authority on `mid` (#2403). The self-revoke configuration disables
that committing action, abstracting the API's atomic refusal, and the leaf writer
stays able to write. For the SDK's initial revoke without carried repairs, the
API returns `container_descendant_rekeys_inaccessible` with the unwritable owed
levels. A custom client submitting self-signed carried repairs is rejected with
403 by cryptographic batch preflight, before mutation or the missing-repair check.
This existing authorization guard is covered by a post-revoke-path signature
regression; the new error code does not replace signature-verification failures.
The SDK reports the terminal API refusal
through the request error reporter and returns null. The separate
`AuthorizedRotateRoot` action models another authorized member completing the
revoke. Fairness on that member's own action establishes
`AuthorizedRevokeEventuallyCommits`; it adds
no fairness assumption to the leaf writer's no-brick property. The route test
`selfRevokeDescendants.test.ts` covers refusal, atomic rollback, completion by
the owner, a proactively carried batch, and a self-revoker retaining a separate
grant on `mid`. Without the authority guard, an incapable rotator leaves `mid`
stale; the negative control checks `GrantedPathNeverStranded` detects that harm.

With rotations carrying their repairs, `mid` is never stale, so the other two
hazards are unreachable, and `GrantedPathNeverStranded` states that directly.
Their controls are therefore taken where a rotation commits alone, which is also
what a dishonest server or a tree past the carried-rekey cap looks like:
`WholePathCurrency = FALSE` checks only the writer's own edge and reproduces a
write the revoked member can open, and `WriterGivenMidKey = TRUE`, the rejected
alternative of serving the writer the intermediate's key so it can repair
upward, violates `WriterHoldsOnlyGrantedKeys`, since that key also opens the
intermediate's other children.

The model abstracts signatures, ciphertext, and policy evaluation. It has one
granted container; production computes the carried set over the whole subtree
and caps it at `MAX_ROTATION_CONTAINER_REKEYS`, past which the remainder repairs
lazily rather than refuse a revocation
([docs/limits.md](../../docs/limits.md#limits-that-trade-write-liveness)
records that as a write-liveness trade). The matching precondition on a
container's first direct grant, a current chain above it, is enforced by
`assertParentKekStateCurrent` and is not modeled: the grant exists from `Init`.
Ordinary group rematerialization retains organization-admin access: the policy
mutation boundary requires organization admin even for a group's own admin
(`lockOrganizationReadModelForPolicyMutation`). Leaving an ordinary group does
not remove that independent root grant. The lost-authority configuration models
standalone user-grant self-revocation; it does not claim that leaving the reserved
Admins group is supported. Supplied carried rekeys still pass their own signed
authorization checks before the final currency check.
The API test `inaccessibleIntermediateRepair.test.ts`
and the SDK tests `carriedDescendantRekeys.test.ts` and
`syncInaccessibleAncestorRepair.test.ts` exercise both sides with real keys.
