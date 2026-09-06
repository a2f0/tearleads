# No Bricked Device

[`NoBrickedDevice.tla`](./NoBrickedDevice.tla) models the invariant that no
device may ever be unable to read or write because another device holds a
cache or must issue a write first (#2192 Gate F1). It exists so that every
client refusal rule is a parameter checked against that invariant before it
is implemented: the withdrawn container currency rule (#2174) and the
principal-policy currency rule (#2173) both failed it in production review,
and the model reports the same failure in seconds.

One dependent object cites one authority. In the container instance the
authority is an ancestor container's manifest head and the dependent a
descendant's; in the principal-policy instance the authority is the Admins
policy head and the dependent a group policy. The honest API commits a
dependent head only for a signer with membership at the current authority
head, citing exactly that head. Devices hold independent checkpoints for both
objects, sync at arbitrary times, and verify each served projection with the
refusal rules. One distinguished member, the late signer, may be revoked at
an authority head; a dependent head that member signed before the revocation
and delivered to a device only after the authority advanced is the honest
shape the currency rules refused.

The abstraction maps to production at these seams:

| Model action or predicate | Production seam |
| --- | --- |
| `AdvanceAuthority` / `RevokeLateSigner` | a share, revoke, rekey, or move committed against the ancestor's current path by `assertCurrentContainerPath`; an Admins successor |
| `CommitDependent` | `assertAccessEventDependenciesMatchRequest`, which refuses a descendant event whose signed citations are not the current heads at commit |
| `HonestSync` / `DishonestSync` | `verifyContainerWriterProjection` verifying the served path through `verifyContainerManifestPath`; `verifyPrincipalPolicyBundle` for a group policy |
| `SyncAuthority` | the ancestor's own projection fetched by `ApiClient.getContainerWriterProjection` |
| `RollbackOk` / `ForkOk` | `verifyAccessManifestLocalCheckpoint` (rollback, equivocation, and a chain that does not extend the checkpoint); `verifyPrincipalPolicyCheckpoint` |
| `CitationOk` | `assertCitedAncestorsDoNotRegress`; `verifyPrincipalPolicyExternalAuthorityProgress` |
| `ServedAuthorityOk` | `assertServedAncestorsDescendFromCitations` on a checkpoint-enforced current path |
| `SignerOk` | the signer authorized by `verifyContainerAccessManifest` against the path `resolveCitedAncestorPath` rebuilds from the event's citations; `externalAuthorityIncludesAdminSigner` |

`StaleHeadOk` and `StaleChainOk` have no production seam by design. The first
is the rule #2174 withdrew: a head newer than the device's checkpoint must
cite the served current authority head. The second is the rule #2173 removed
from `verifyPrincipalPolicyExternalAuthorityProgress`: every chain entry
newer than the checkpoint must cite it. Both stay in the model as parameters,
`FALSE` in every registered configuration, so the negative controls below can
show what each would cost.

## Registered configurations

[`NoBrickedDevice.cfg`](./NoBrickedDevice.cfg) sets `ServerHonest = TRUE`
with the production rule set, two devices, and three versions of each object.
Only the honest server's delivery to each device is fair; writes are not, so
the liveness property `DeviceEventuallyCurrent` must hold on behaviors where
no other device ever writes again. TLC also checks that checkpoints and held
citations are monotone, that a held chain never contradicts a checkpoint the
device already held, that the held authority covers the held citation, that
the held signer had membership at its citation, and that the honest server is
never refused. The run explores 78,678 generated and 16,016 distinct states at
depth 9.

[`NoBrickedDeviceAdversary.cfg`](./NoBrickedDeviceAdversary.cfg) sets
`ServerHonest = FALSE`: a served projection may carry any genuine authority
head and any dependent head the late signer could have forged, agreeing with
the honest chain through any prefix. The safety properties are per device, so
this configuration uses one device; liveness is not checked, since a
dishonest server can simply withhold. The run explores 136,428 generated and
4,676 distinct states at depth 7.

## Negative controls

`bun run check:protocol-negative-controls` (part of `check:fast`) derives one
configuration per entry in `scripts/protocolNegativeControls.ts`, flips a
single rule, and requires TLC to report exactly the named violation:

- `RefuseStaleHeadCitation = TRUE` violates `DeviceEventuallyCurrent` and, as
  a safety latch, `HonestServerNeverRefused`: a device holding the dependent
  refuses the honest late-delivered head and can only advance after another
  device writes.
- `RefuseStaleChainCitation = TRUE` violates `DeviceEventuallyCurrent`: the
  refused entry stays in the chain, so even a later honest successor citing
  the current authority cannot heal the device.
- Turning off `RefuseFork`, `RefuseRollback`, `RefuseCitationRegression`,
  `RefuseServedAuthorityRollback`, or `RefuseSignerRevokedAtCitation` under
  the adversary violates, respectively, `HeldChainNeverContradictsCheckpoint`,
  `CheckpointsAreMonotone`, `HeldCitationsNeverRegress`,
  `HeldAuthorityCoversHeldCitation`, and `HeldSignerWasMemberAtCitation`.

A future refusal rule is added as one more parameter, set `TRUE` in the
registered configurations only once the liveness run still passes.

## Boundary

Authority heads need an admin signature, so a dishonest server can roll one
back but not forge one; dependent heads can be forged by the late signer,
whose membership is the only one the model distinguishes. A forged dependent
head that extends the honest chain beyond a device's checkpoint, signed while
the late signer still had membership at the head it cites, is accepted: that
is the documented residual a revoked ancestor member keeps until the next
legitimate event on the descendant, and the reason the currency rules were
tempting. A device that accepts such a head holds a branch the model does not
track, so it takes no further step; detecting that split view needs the
transparency witnessing of #2186 Part C, not a refusal rule. Signatures,
hashes, the grant algebra, and the checkpoint persistence are outside the
abstraction. This is exhaustive bounded model checking, not a proof.
