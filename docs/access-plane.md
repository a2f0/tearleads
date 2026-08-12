# Access Plane

## Summary

The access plane is driven by signed access events and derived access
manifests. The server stores and indexes those manifests, but the authorization
state itself is client-verifiable.

For shared protocol terminology, see [glossary.md](./glossary.md).

Protected objects are:

- containers
- documents
- blobs

Container manifests carry direct grants and parent links. Document manifests
carry linked container ids. Blob access is derived from active signed attachment
bindings and the linked document manifests.

## Authority

The authority chain is:

1. A user signs an access event.
2. The event body deterministically derives the next object manifest state.
3. The manifest hash becomes the stored object head.
4. Key-target tables store the wrapped material that matches that manifest.

The durable tables are:

- `access_events`
- `access_manifests`
- `access_manifest_heads`
- `access_event_dependency_projection`
- `access_manifest_principal_head_projection`
- `access_manifest_document_link_projection`
- `container_key_epochs`
- `container_key_wraps`
- `document_content_key_epochs`
- `document_content_key_targets`
- `document_content_write_headers`
- `blob_content_key_epochs`
- `blob_content_key_targets`
- `blob_content_write_headers`

The list/read services authorize from `access_manifest_heads` plus the signed
manifest path. They do not maintain a parallel mutable grant or epoch table.

## Principals

Users have registered signing and encapsulation keys. Groups and organizations
are managed principals with signed policy state:

- `principal_states`
- `principal_state_payloads`
- `principal_membership_projection`
- `principal_epoch_keys`
- `principal_member_envelopes`

Group and organization grants require referenced signed principal heads.
Managed-principal access fails closed when the referenced policy state or member
envelopes are missing or stale.

The API re-verifies stored policy bundles before returning them or using their
projections for container and direct organization authorization. This includes
the signed history, signer identity fingerprints, projection and membership
roots, current payload and member-envelope commitments, transition rules, and
any exact reserved-`Admins` authority citations. Direct edits to permission
projection rows therefore fail with an integrity conflict even when the API
process itself is honest but its database contents were altered.
Direct organization authorization also verifies the signed organization
authority descriptor before trusting the database's reserved `Admins` and
`Members` identifiers, so repointing either identifier to another valid group
fails closed.

The version-2 organization authority descriptor also commits the exact current
head of every organization group. Supported clients pair every group successor
with an organization-policy successor through one atomic policy commit. Before
using a group for sharing or rotation-staleness decisions, a client verifies
the organization policy and reserved `Admins` head, then requires the served
group bundle to match the directory's exact head. Serving an older, otherwise
valid group policy therefore fails closed even on a device with no prior
checkpoint for that group. Group deletion requires a signed organization-policy
successor that removes the deleted group from the directory; the API rejects
directory entries for groups that are not active organization rows.

The version-2 descriptor is an intentional greenfield state-format flag-day.
Deployments must drop and recreate pre-v2 API and local client databases and
reprovision their organizations. Version-1 descriptors are rejected; there is
no compatibility reader or in-place upgrade path.

The generic principal-policy write route rejects group updates. Group creation
atomically stores the new row and initial policy with the matching signed
organization-directory successor, so a failed second artifact cannot leave an
active but undiscoverable group.

Container authorization likewise re-verifies every stored manifest on the
historical authorization path. The API verifies the event signature and signer
identity, derives the transition from the signed event body, recomputes the
manifest hash, checks dependency paths and referenced principal policies, and
binds current manifests back to the container hierarchy rows. A database edit
that forges a direct user grant, parent edge, or transition artifact therefore
produces an integrity conflict instead of server-side access. Verified
content-addressed manifests are retained in a bounded process cache keyed by
both the claimed hash and stored source fingerprint, amortizing signature-chain
verification without accepting an in-place edit under an existing hash.
Stored document link-set manifests receive the same treatment before document
or blob authorization: the API reconstructs the signed link/unlink history and
its verified container paths rather than trusting mutable `linkedContainerIds`
or document-link projection rows.

Repointing a database head to a genuine older signed manifest is a replay, not
a forgery, and the API has no independent checkpoint outside that database from
which to detect it. A client that has persisted a newer checkpoint rejects the
rollback. Cold-client rollback and truncation require an external transparency
source, witness, or gossip peer to detect reliably.

Organization grants remain valid cross-organization sharing subjects. Group
grants stay within their owning organization so the reserved `Admins` actor can
always materialize every required rekey during a group rotation. The grant's
`read`, `write`, or `admin` level is separate from authority to manage the
principal itself.

Each signed group policy commits its complete container-grant projection with
`grantRoot` and `grantCount`. Organization grant lanes are presentation and
discovery indexes only. Membership and key rotations enumerate the verified
signed projection, while the API verifies the exact required container batch
against current signed manifests before committing either side.

Organizations also carry two reserved group pointers:

- `adminGroupId` points to the reserved `Admins` group. Users reachable through
 this group have organization-admin authority.
- `memberGroupId` points to the reserved `Members` group. Users reachable
 through this group belong to the organization.

Registration creates both groups atomically, seeding each with the single
registering user, and commits both initial heads in the organization policy.
Principals contain only users; policy writes enforce that managed principals
name active roster entries and that every Admins user remains a Members user.
Org-manager keeps separate roster rows for directory lifecycle state. Active
roster entries are synchronized from users reachable through `Members`, while
disabled roster entries can remain visible after access removal. The roster is
not access authority; signed groups and container grants remain authoritative.
Optional roster profile details are bound by `profileDocumentId` and live in
encrypted documents, not in plaintext directory responses. Org-manager hides
both reserved groups from the normal group list. The organization principal
policy is still signed managed-principal state, but org-manager does not expose
`directory.users[].role` or treat organization-principal roles as product
authorization.

## Containers

Containers form a tree. A container access manifest includes:

- `containerId`
- `organizationId`
- `epoch`
- `parentContainerId`
- `parentManifestHash`
- `metadataDocumentId`
- `containerKeyEpochId`
- `directGrants`
- `referencedPrincipalHeads`

Effective access is resolved across the manifest path from root to target.
Grants are additive along that path. A read grant authorizes listing and reading
objects under the container. Write/admin grants are required for writer
projections because those responses include KEK material for future writes.

## Documents

Documents do not own direct ACLs. A document link-set manifest includes:

- `documentId`
- `organizationId`
- `epoch`
- `previousManifestHash`
- `linkedContainerIds`

A user can read a document when at least one linked container path grants read
or stronger access. The document `accessEpoch` exposed by list/sync surfaces is
the document manifest epoch. The document access-state hash exposed by list
surfaces is the document manifest hash.

The server maintains `access_manifest_document_link_projection` from the signed
document manifest so container document listings can be indexed without parsing
encrypted document content.

## Blobs

Blob bytes are stored separately from signed attachment state. A blob is
readable when at least one active attachment binding points to a readable
document.

Blob encrypted bytes are also stored separately from blob content-key bundles.
The encrypted payload record commits to the blob id, content-key epoch,
content-record id, metadata hash, nonce-domain hash, IV, suite, and ciphertext.
The key package lives in blob content-key epoch/target rows and is returned by
attachment listing or bind responses for authorized document readers.

Attachment bind and detach mutations store signed access events and update the
live `attachment_bindings` projection. Detached bindings are transient live
metadata; durable attachment history belongs to the document audit layer.

## Write Flow

Document writes submit:

- `contentKeyEpoch`
- `expectedLinkSetManifestHash`
- `expectedTargetHash`
- optional `contentKeyBundle`
- optional signed `containerRekeys[]`
- signed write headers for outgoing updates

The server accepts writes only when the submitted manifest hash and target hash
match the stored heads and derived key-target material.

Blob bind writes submit:

- signed attachment event and body
- verified document manifest
- authorizing container paths
- optional signed `containerRekeys[]`
- blob content-key bundle
- optional staged blob write header

Blob stages are created through the multipart staging routes and uploaded as
binary parts. The bind path treats a stage as a temporary encrypted upload
owned by the authenticated user and promotes only a completed, unexpired
stage.

## Read Surfaces

Read/list routes use the same signed manifest state:

- `GET /containers`
  - lists containers reachable from manifest direct grants and managed-principal
    projections
- `GET /containers/:containerId/documents`
  - requires read access to the container manifest path
  - lists documents whose current link-set manifest projects into that container
- `GET /documents/:documentId/attachments`
  - requires read access through at least one linked container path
- `GET /blobs/:blobId`
  - requires read access through at least one active binding's document
  - returns committed encrypted blob metadata and string-encoded bytes
- `GET /blobs/:blobId/bytes`
  - requires read access through at least one active binding's document
  - streams committed encrypted blob bytes with digest headers

## Audit Boundary

Audit rows snapshot the signed manifest identity accepted by the live write
path:

- `access_epoch`
- `access_manifest_hash`
- `access_state_hash`

The audit tables are append-only history structures. Live tables such as
`document_updates`, `attachment_bindings`, `blobs`, and key-target tables remain
optimized for sync and present-time access decisions.

## Non-Goals

- Retroactive revocation of bytes already received by a former recipient.
- Zanzibar-style relationship algebra.
- Branch-specific access semantics.
- Replacing signed client authorization with server-authored ACL state.
