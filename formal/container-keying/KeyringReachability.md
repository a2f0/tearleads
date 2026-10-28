# Container keyring reachability

[`KeyringReachability.tla`](./KeyringReachability.tla) models cold recovery of
one container's KEK history from three immutable rotation artifacts: member
wraps retained per epoch, a write-once bridge from each epoch to its
predecessor, and a sealed keyring of every predecessor key. A poisoned
artifact fails its material-id check and is detected, never silently used, so
integrity is a boolean per artifact. `Members` are the users authorized by
active direct-user or same-organization group grants; organization principals
are not recovery recipients. `Descendants` are child containers whose key
epochs pin the parent epoch current when they were minted.

| Model action or predicate | Production seam |
| --- | --- |
| `RotateSealing` / `Rotate` | a rotation stores its bridge, checked against the signed event by `computeContainerKekPredecessorBridgeHash`, and a sealed keyring whose length must match its key epoch (`assertSealedContainerKekKeyringLength`) |
| `Expand` / `Closure` / `LogGroundTruth` / `BoundedSeverance` | `rebuildKeyringEntriesFromLog` walks the bridge log served by `runContainerKekLogWorkflow` and fetched by `fetchContainerKekLog`; `unwrapKeyringContainerKeksAtIndex` opens a retained keyring; `assertUnwrappedContainerKekMatchesMaterialId` checks each recovered key |
| `PersonalRecoverable` / `WrapBackstop` / `HonestSnapshotComplete` | `recoverKeyringEntryFromWraps` re-anchors the walk on a wrap addressed to this member, below a severed bridge |
| `PinChild` / `PinnedEpochVerifiable` / `StrictParentEpochPin` | `creationParentEpochId` records the parent epoch a child pins; `resolveContainerKekParentBinding` accepts any pin the parent's retained history covers (#2330) |
| `SealWithServedForgery` / `RequiredEpochIds` / `AnchorToSignedLineage` | `signedHistoryEpochIds` walks the verified lineage from the head, wherever the projection served it, and requires each id it names; `manifestHistoryEpochIds` is the KEK's own served bucket, all the check consulted before #2365 finding 32; `assertOverrideMatchesSignedLineage` holds a rebuilt override to the same lineage, and every re-sealing rotation takes its target from `signedRotationTarget` |

## Served lineage

An honest rotation also seals entries it did not mint: a repair rebuilds them
from the log and server-offered anchors, and every other rotation re-seals the
served keyring. Either may carry a forged entry, an invented epoch id over
server-chosen material, whose material check passes, standing in for a real
epoch id at the same position. The signed manifest lineage names every real
id, so a check that requires those ids refuses the forgery.

Where the lineage arrives is the server's choice for each projection.
`SealWithServedForgery` takes it as a parameter: under the container's own KEK
or under its parent's. An honest server may do either, and the SDK test
`containerKekPathRelocatedLineage.test.ts` opens honest history served under
another KEK. The anchored walk follows the verified lineage from the head
wherever it was served, so its required ids do not depend on the location and
an honest keyring seals the same either way. A check confined to the KEK's own
bucket requires the real ids only while the server serves them there; moved
under the parent, the bucket is empty and the forged entry passes.

`RotationsSealOnlySignedLineage` holds with the anchored walk. The negative
control `kek-history-anchor-seals-relocated-forgery` sets
`AnchorToSignedLineage = FALSE`, and the violation needs a rotation whose
projection served the lineage under the parent. Restricted to projections
served under the container's own KEK, the same switch violates nothing: the
own-bucket check is enough against an honest placement, and the anchor is what
defeats a relocation. `keyringOverrideLineage.test.ts` exercises the
production refusals.

## Registered configuration

[`KeyringReachability.cfg`](./KeyringReachability.cfg) runs four epochs, two
members and one descendant with the production rules. It checks that wraps
address only the members present when their epoch was minted, the log ground
truth, bounded severance, honest snapshot completeness, the wrap backstop,
that an honest server never strands a descendant, and that rotations seal
only the signed lineage. The run explores 4,572,248 generated and 914,952
distinct states.

The control `strict-parent-epoch-pin-strands-descendant` accepts only the
parent's current epoch and violates `HonestServesNeverStranded`: one ancestor
rotation strands every earlier-pinned descendant.

## Boundary

Every current member is assumed to hold the current KEK, and the properties
share `Closure` with the recovery they check. The model does not represent
what a revoked member already knows, so excluding revoked members from
recovery is not a proof that they cannot derive later keys. Signatures, the
material-id commitment and the wraps' cryptography are outside the
abstraction; group key epochs are covered by
[GroupGrantRevocation](./GroupGrantRevocation.md). Writes still demand
current parent pins, and
[InaccessibleIntermediateRepair](./InaccessibleIntermediateRepair.md) covers
who restores them.
