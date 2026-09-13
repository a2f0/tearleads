# Verified root and system destinations

[`SystemDestination.tla`](./SystemDestination.tla) covers finding #8 in #2266.
An untrusted listing claims a root edge and a system slot. A client may merge
pre-login content only into its session's own verified root. System writes must
use the signed slot on a root child. Minting a system slot requires an admin of
that root, so an ordinary writer cannot create a foreign-organization decoy.

| Model action or predicate | Production seam |
| --- | --- |
| `SelectView` / `PreserveSessionAcknowledgment` | `restoreSessionRoots` restores identity-bound acknowledgements independently of view selections |
| `Hydrate` / `VerifyDestination` | `verifyRemoteContainerDestination` verifies the projection and reads its signed fields |
| `MergeRoot` / `RequireSessionRoot` | `canUseRemoteRootAsLocalRootReconciliationTarget` checks the session root identity |
| `MoveDestination` / `PreserveDestinationIdentity` | `deriveContainerMoveManifestState` forbids moves of roots and system containers |
| `UseSystem` | `findSystemContainerStateForRoot` selects the authenticated slot |
| `CreateSystem` / `RequireSystemAdministrator` | `deriveContainerCreateManifestState` requires root-admin authority for slots |

The model has four candidate identities, two creator roles, and shared/private
variants. Signature checks and organization matching are abstracted by the verified
manifest boundary. Classification does not advance write-authority checkpoints
or require KEK decryption; actual writes verify current authority separately.
Root and system parent edges cannot move, and signed slots are immutable. It models
one classification snapshot, not network availability, listing completeness, cache
lifetime, or authoring races. Root identity comes from server acknowledgements
and must
also match a signed parentless manifest; an unsigned login response alone is
insufficient to make an ordinary shared folder a root.

Each of the six guards has a negative control. The shared-system invariant
keeps extra recipients from becoming a reason to refuse a legitimate Trash or
Contacts destination. Runtime regressions exercise forged listing fields using
real signatures and SQLite persistence, including an ordinary container and a
legitimate system container. The crypto
authorization matrix separately covers an additional direct recipient.

The SDK caches only the immutable role, parent identity, and metadata id of
verified roots and system containers, with a bounded per-database cache. Grant,
key and ordinary-container parent state are never cached by this classifier.
The model covers the immutability requirement for reuse, not cache eviction.

Session root acknowledgements are stored separately from the local root
awaiting reconciliation. Login updates the acknowledgement; reconciliation
updates the view after moving local document references. Local bootstrap and
view selection cannot replace the acknowledgement. Encrypted session persistence
retains the per-organization acknowledgements under the signing fingerprint.
Registration and organization creation also record server acknowledgements;
organization switching selects among them without trusting listing roots.
