# Verified root and system destinations

[`SystemDestination.tla`](./SystemDestination.tla) covers finding #8 in #2266.
An untrusted listing claims a root edge and a system slot. A client may merge
pre-login content only into its session's own verified root. System writes must
use the signed slot in its required topology: organization metadata has an
independent root, while other slots are direct root children. Minting either
requires administrator authority, so an ordinary writer cannot create a decoy.

| Model action or predicate | Production seam |
| --- | --- |
| `SelectView` / `PreserveSessionAcknowledgment` | `restoreSessionRoots` restores identity-bound acknowledgements independently of view selections |
| `Hydrate` / `VerifyDestination` | `verifyRemoteContainerDestination` verifies the projection and reads its signed fields |
| `MergeRoot` / `RequireSessionRoot` / `RequireRootScope` | `isSessionRootState` checks the session root identity and organization at the reconciliation boundary, after `verifyRemoteContainerDestination` checks its signed organization |
| `MergeRoot` / `RequireRootCreator` | `assertRootCreatedBySessionUser` requires the acknowledged root's epoch-1 create, found by `verifiedContainerCreateManifest`, to be signed by the session user; `assertAcknowledgedRootSigner` applies it on hydration and `isVerifiedLocalRootReconciliationTarget` before every local root merge, using only the role remote hydration verified and cached (an uncached role leaves the merge pending) |
| `Login` / `RefuseRootSwap` | `acknowledgeSessionRoot` refuses a different root id for an already acknowledged organization; `commitSessionRootAcknowledgment` decides and commits it against the live snapshot and records the incident |
| `MoveDestination` / `PreserveDestinationIdentity` | `deriveContainerMoveManifestState` forbids moves of roots and system containers |
| `UseSystem` / `RequireSystemScope` | `findSystemContainerStateForRoot` selects the authenticated slot in the active organization and acknowledged root |
| `CreateSystem` / `RequireSystemAdministrator` / `RequireSystemTopology` | `assertContainerSystemTopology` permits only the organization-derived metadata slot at a root; `deriveContainerCreateManifestState` requires administrator authority and complete root parent paths for all other slots |

The model has four candidate identities, two creator roles, shared/private
variants, two authenticated slot roles, and three positions (root, root child,
or nested child). The metadata role means the signed slot exactly matches the
digest derived from the signed organization ID; an unsigned slot claim cannot
select this role. `MetadataRootCreationAllowed` also prevents a vacuous repair
that rejects every independent metadata root. Signature checks and organization
matching are abstracted by the verified manifest boundary. Hydration rejects
invalid topology, and `SystemWritesUseValidTopology` covers its use boundary.
A metadata root remains a system destination and never becomes the session root
for pre-login content. Classification does not advance write-authority checkpoints
or require KEK decryption; actual writes verify current authority separately.
Root and system parent edges cannot move, and signed slots are immutable. It models
one classification snapshot, not network availability, listing completeness, cache
lifetime, or authoring races. Root identity comes from server acknowledgements
and must
also match a signed parentless manifest; an unsigned login response alone is
insufficient to make an ordinary shared folder a root.

Each of the eleven guards has a negative control. The shared-system invariant
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
awaiting reconciliation. The first login for an organization records the
acknowledgement; reconciliation updates the view after moving local document
references. Local bootstrap and view selection cannot replace the
acknowledgement. Encrypted session persistence retains the per-organization
acknowledgements under the signing fingerprint. Registration and organization
creation also record server acknowledgements; organization switching selects
among them without trusting listing roots.

The login response is unsigned, so two further rules bind the root it names.
A later login may repeat an organization's acknowledged root or report it
purged (null), the only transitions an honest server produces, but a different
root id for an already acknowledged organization is refused and recorded as a
security incident; a purged organization never regrows a root. Independently,
the acknowledged root only becomes the pre-login merge target when its verified
epoch-1 `container.create` was signed by the session user: every acknowledged
organization was created by that user, whose device signed the root, so a root
created by anyone else is a substitution however it is granted. The lineage is
already verified when the head is, and the creator check also runs on cached
role reuse. The model keeps `rootCreatorIsUser` as an unconstrained boolean and
`Login` as a free action; the negative controls flip each rule alone.

A missing root row does not relax destination scope: slot lookup still checks
the active organization and any acknowledged root id before choosing a target.

Every listed root role is verified, including roots of organizations first seen
on this device. Those roots can serve their own organization system flows without
becoming the session's personal merge destination. Root lookup uses the unique
verified root in such an organization; pre-login reconciliation and stale-root
recovery continue to require an explicit session acknowledgement.

Slot creation covers metadata roots, ordinary root children, and invalid
combinations of role and position. The crypto regressions permit the exact
organization metadata root and reject other root slots, metadata children,
grandchildren, and truncated proofs that present non-root parents as roots.
The metadata root has explicit Admins and Members grants and independent keys;
those recipient and key-verification rules are outside this destination model.
