# Repair below an inaccessible stale intermediate

[`InaccessibleIntermediateRepair.tla`](./InaccessibleIntermediateRepair.tla)
covers finding 1 in #2340. On a path root → mid → leaf, a root rotation would
leave `mid` pinned to the retired root epoch. A writer whose only grant is on
`leaf` cannot re-key `mid`, and must not be given its key. The model shows that
the writer's writes nevertheless never depend on another device.

| Model action or predicate | Production seam |
| --- | --- |
| `RotateRoot` | `assertGrantedPathsCurrentBelow` refuses a rotation that leaves a level above a directly granted container stale; `planCarriedDescendantRekeys` signs the rekeys it must carry |
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
only because `RotateRoot` re-keys `mid` in the same step, which the rotator can
always do since access and keys inherit downward. `leaf` is never part of that
step: it is the writer's own to repair. Setting `RotationCarriesRepairs = FALSE`
is a rotation that commits alone, and the writer is parked for good on every
behavior where no other member writes beneath `mid` again. A best-effort repair
by the rotating device afterwards would not change that verdict.

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
lazily rather than refuse a revocation. The matching precondition on a
container's first direct grant, a current chain above it, is enforced by
`assertParentKekStateCurrent` and is not modeled: the grant exists from `Init`.
Group rematerialization is one more `RotateRoot`, checked by the same seam.
The API test `inaccessibleIntermediateRepair.test.ts`
and the SDK tests `carriedDescendantRekeys.test.ts` and
`syncInaccessibleAncestorRepair.test.ts` exercise both sides with real keys.
