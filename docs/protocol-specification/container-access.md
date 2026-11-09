# Protocol Specification: Container Access

Part of the [protocol specification](../protocol-specification.md).

## Container Access And KEK Protocol

[Container](../glossary/access.md#container) create bodies and manifest
structural state carry a required nullable `systemSlot`. A non-null slot is
signed, immutable, and allowed only on a root child created by a root
administrator. Composite create requests must repeat the exact signed value.
Normal children may still be created by writers.

Before adopting a listed root or system destination, the SDK verifies its writer
projection and uses the manifest's parent edge, metadata document id, and slot.
Pre-login content merges only into the session root id with a signed parentless
manifest in the session organization. Login returns that root id (or null after
purge); the login response alone does not authenticate its role. Shared system
containers remain valid destinations. Projection GETs require read access;
signed mutations still enforce their own write/admin authority. Destination
classification verifies signed history without advancing write checkpoints. Root
and system containers cannot move, so their roles and parent identity remain
stable across later [grants](../glossary/access.md#grant), recitations, and
[rekeys](../glossary/keys.md#rekey).

Signed container mutation routes are:

- `POST /containers`
- `POST /containers/with-metadata-document`
- `POST /containers/:containerId/share`
- `POST /containers/:containerId/revoke`
- `POST /containers/:containerId/rekey`
- `POST /containers/:containerId/move`
- `POST /containers/:containerId/recite` (`ContainerReciteRequest`)

Most signed mutations use `ContainerMutationRequest`. The container with
metadata document create route wraps a `ContainerMutationRequest` with the
initial metadata `DocumentCreateRequest`, and an optional
`initialMetadataSync` seed that follows the
[document create seed](../document-link-and-sync-protocol.md) rules.

Each signed mutation request carries:

- signed event and event body
- expected manifest hash and derived manifest state
- optional `previousManifestRef`, `previousContainerPathRefs`,
  `parentContainerPathRefs`, `destinationParentContainerPathRefs`, and
  `containerManifestHistoryRefs`: `{containerId, manifestHash}` citations of
  manifests the server already stores, never the bundles themselves. No list
  may cite one manifest twice, and history cites only the mutated container
  (the one `previousManifestRef` names), so both are refused with `400`
  before any citation is read; the history then loads in one bulk read
- `principalPolicyRefs`: `{principalType, principalId, version, stateHash}`
  heads of the principal policies the mutation was planned against, at most
  4,096 (`MAX_CONTAINER_PRINCIPAL_POLICY_REFS`), never the policies themselves
- a container key epoch
- a required nullable
  [predecessor bridge](../glossary/keys.md#container-kek-predecessor-bridge) (`null`
  for creates and same-epoch mutations; populated for every KEK rotation)
- a required nullable [sealed keyring](../glossary/keys.md#container-kek-keyring)
  (`null` for creates and same-epoch mutations; for every rotation, the complete
  predecessor key history sealed under the new KEK, with its hash committed in
  the signed event body)
- KEK wraps for derived recipient targets
- `parentKekRef`: `{containerId, containerKeyEpochId, keyEpochHash}`, citing
  the parent's current KEK epoch for a child container (never the parent's
  full KEK state; the API loads that epoch from its own store and refuses a
  citation of any other epoch with `409 container_mutation_state_stale`), and
  optional direct user recipient keys

The API verifies the signed event, derives the manifest, checks predecessor and
path heads, verifies referenced principal policies, derives recipient targets,
and verifies the container KEK state. Each principal policy ref must name the
principal's current head, or the mutation is refused with
`409 principal_policy_stale` and the current heads the requester may read; the
API then authorizes from its own verified copy of each head. The `stateHash`
commits the signed state, and with it the projection and grant roots, so the
head pins everything an inline policy would have carried. Every cited manifest
is resolved from the API's own artifacts: a manifest an earlier mutation of the
same batch verified, or the stored bundle, re-verified because database rows are
not a trust boundary. A citation whose hash is not stored, or whose
`containerId` names a different container, is refused with `409`. The previous
manifest and every path element must also be the container's current head, and
the signed event's `dependencyManifestHashes` must equal the cited hashes, so a
stale or uncited head is refused. Only the new manifest the mutation commits
travels in full; a recitation cites its previous head and current path the same
way. Container KEK wraps target direct users,
[managed principals](../glossary/principals.md#managed-principal), or the parent
container KEK. A child container can inherit access through parent KEK edges without
rewriting every descendant object when an ancestor grant changes.

For a rotation, the API also verifies that the bridge connects the stored
current epoch to exactly the proposed next epoch, that the keyring is sealed to
the new epoch with a ciphertext length exactly matching the epoch number
(`8 + (n - 1) * 64 + 16` bytes — over- and under-length both reject), and that
both artifact hashes match the signed event body. Epoch numbers above
`MAX_CONTAINER_KEY_EPOCH` (65536) are rejected at rotation time as a
runaway-rotation backstop; the other protocol bounds are listed in
[limits.md](../limits.md). Writer projections are gated by current access and
return the sealed keyring for each path epoch (null exactly at epoch 1).
Consequently current document access includes retained history; projections do
not return superseded recipient envelopes or filter old epochs by requester
membership era. `GET /containers/:containerId/kek-log` serves the append-only
rotation log — every epoch with its write-once bridge and sealed keyring — as
the rebuild/repair read path for any current reader.

Container and document writer projections carry each access-manifest bundle
once, in a `bundles` map keyed by manifest hash. Every manifest position cites
that map by hash: the container `path`, each KEK's `containerManifestHistory`,
and, for documents, every authorizing path, `documentManifest`,
`documentManifestHistory`, `documentContainerManifestHistory`, and each
`documentManifestContainerPaths` row. Bundles are the stored bytes, so no signed
bytes change. A cited hash without a bundle, a bundle stored under a key other
than its own `manifestHash`, or a bundle nothing cites is a response-shape
failure. The client resolves every citation to its own copy of the bundle
before any cache or verifier sees the projection, then verifies the result,
recomputing each cited manifest's hash before any position that cites it is
trusted.

A projection GET may send `x-known-manifests`: up to 48 unique typed digests of
bytes the device durably holds verified. `m:<hash>` names a manifest bundle by
its manifest hash; `k:<digest>` names a container KEK level by a
domain-separated SHA-256 of its canonical wire JSON (its manifest history cited
by hash). After its ordinary authorization and stored-evidence verification, the
API omits the bundle of each listed hash the projection cites and lists those
hashes in the required `omittedBundles`; every other cited hash travels in
`bundles`, and unknown hashes are ignored. A KEK level whose served bytes have a
listed digest travels as `{levelDigest, containerManifestHistory}`, so its
manifest citations still count; a rotated epoch, a new wrap, or any other change
gives the level a new digest, and it travels in full. A hash must not be both
served and omitted, and an omitted hash must be cited. The client fills an
omitted bundle, and replaces each level stub with its own copy of the held
level, only from the bytes its request cited, and only when the held level's
manifest citations equal the stub's; otherwise it refetches once with no hints.
Hints grant nothing: the projection is authorized, and the rebuilt projection
validated and verified, exactly as without them.

The client cites from its
[verified-bundle cache](../projection-policy-evidence.md#cost-and-retained-history-tradeoff),
never across organizations: the latest verified KEK level of each container on
the target's lineage, then those objects' bundles, then its organization's most
recently verified bundles. Lineage follows stored container parents. A container
the device has not stored yet, such as a folder a hydration pass prefetches from
a listing, takes its listed parent's lineage, and the listing's organization is
one more source that must agree; a wrong listing only changes which held bytes
are cited.

Principal rotations and membership mutations rematerialize every retained
group container grant in the same transaction as the new principal state. The
resulting container mutation names the new principal head and wraps the current
container KEK to that head. A user restored onto a fresh client therefore needs
only the current verified principal policy and the current container grant to
recover every still-authorized container; recovery never walks historical
principal keys and does not depend on another user performing a repair action.

Completeness is authenticated by the principal state itself. `grantRoot` is
the digest of the sorted canonical `{containerId, accessLevel}` projection and
`grantCount` binds its cardinality. Policy requests and bundles include the
full projection for every state. During a transition the client plans from the
verified current/next projections, and the API recomputes the required union
from stored verified manifests. The policy state and the exact container batch
commit or roll back together; standalone group-grant changes are accepted only
when they already match the current signed projection.

The API intentionally exposes no historical principal-key envelope endpoint.
Serving a requester's subset of historical envelopes cannot prove inclusion in
the full `memberEnvelopesRoot`, while serving the full set would disclose
membership history. Keeping recovery on current rematerialized grants avoids
both the unverifiable subset and tenure-scoping problems. Removed users cannot
read the replacement wraps; users later re-added receive the current principal
key and recover through the grant's current rematerialization.

Document and blob writes may carry signed `container.rekey` requests inline in
`containerRekeys[]`. The API applies those rekeys inside the same transaction
before resolving document/blob targets. If the enclosing write fails, the rekey
rolls back with it.

For document sync, a stale inline rekey returns
`document_sync_state_stale`. When the stale state is a principal policy, the
response may include the current `principalHeads[]` the requester may read;
clients recover those heads through ordinary policy reads before refetching the
writer projection and replanning.

An absent target on `DELETE /containers/:containerId`, a document-listing lane,
or writer-projection reads returns `404 container_not_found` (a lane `failure`).
Clients may treat that exact pair as permanent absence: delete installs a
maximal anti-resurrection fence, document listing treats the lane as
unavailable, and restoration sweeps may purge retained dormant metadata. A bare,
malformed, unknown, or wrong-status tag is not deletion authority and fails
closed.

A successful container mutation (create, share, revoke, rekey, move, recite,
with-metadata-document, the carried `containerRekeys`, and each
`containerMutations` entry of a principal policy commit) acknowledges by hash.
The response carries the identity the client signed (`containerId`,
`organizationId`, `parentId`, `systemSlot`), the server-assigned `createdAt` and
`updatedAt`, `eventHash`, `manifestHead`, and, except for a recitation,
`containerKek` with `containerKeyEpochId`, `containerKeyEpoch`, `keyEpochHash`,
`keyTargetHash`, `keyringHash` (null exactly at epoch 1), and
`parentContainerKeyEpochId`. It never echoes the signed event, body, manifest,
state, key epoch, wraps, keyring, recipient targets, or KEK history. The client
compares each hash with the plan it signed and records state built from that
plan; any mismatch refuses the acknowledgement. The manifest hash commits to
the derived state, and `keyTargetHash` commits to every wrap recipient, so a
wrap stored for anyone else cannot match. Later writer projections still verify
what the server stored.

Document creates (including a with-metadata-document's metadata document and
every provisioning document) and link-set mutations acknowledge the same way:
`id`, the signed `eventHash`, the committed `manifestHash`, the stored
`contentKeyEpoch`, the resolved KEK `targetHash`, and, for a create,
`createdAt` and the seed's `initialSync`. The client records the manifest,
content-key bundle, and KEK targets from its plan. A document sync likewise
returns no current content-key bundle or KEK targets: the client persists the
bundle and targets its request named. An attachment bind returns the binding
identity, `eventHash`, `contentKeyEpoch`, `writeHeaderHash`, and the hashes of
the resolved KEK targets, `blobKeyTargetHash`, and blob access manifest,
`blobAccessManifestHash`; the client compares both with what it signed. It no
longer echoes the event, wraps, write header, KEK targets, or write
authorization, which a staged upload's bind stores as exactly the targets its
bundle wraps to.

Behavior-bearing container mutation conflicts use stable tags. A stale parent
or concurrent mutation returns `409 container_mutation_state_stale`; a
stable-id create retry returns `409 container_manifest_already_exists`, which
proves the container committed and permits lost-response adoption. A compound
create may instead return `409 document_manifest_already_exists`; that conflict
can roll back the newly created container, so it is terminal unless the client
independently verifies both remote artifacts. Clients replan or adopt only on
the exact status and code. Missing, malformed, and unknown tags are terminal.

## Document Link And Sync Protocol

The normative link, write-verification, pagination, checkpoint, and conflict
rules live in [Document Link and Sync Protocol](../document-link-and-sync-protocol.md).
