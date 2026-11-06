# Keying Design: Access Manifests

Part of the [keying design](../keying-design.md).

## Signed Access Manifests

Every security-relevant graph mutation is represented by a signed access event
and a derived access manifest.

Protected manifest scopes:

- organization;
- container;
- document link set;
- blob attachment/target set, derived from signed
  [attachment binding](../glossary/content.md#attachment-binding) events.

The API may store materialized [projection rows](../glossary/sync.md#projection-row),
but they are not authority. A client verifies manifests and derives projections
locally.

### Access Event Shape

Each mutation signs canonical bytes for an event like:

```ts
type AccessEvent = {
 version: 1;
 eventId: string;
 eventType:
 | "container.create"
 | "container.grant"
 | "container.revoke"
 | "container.rekey"
 | "container.recite"
 | "container.move"
 | "document.link"
 | "document.unlink"
 | "document.purge"
 | "attachment.bind"
 | "attachment.detach";
 objectKind: "container" | "document" | "blob";
 objectId: string;
 organizationId: string;
 previousManifestHash: string | null;
 dependencyManifestHashes: string[];
 bodyHash: string;
 signerUserId: string;
 signerDeviceId: string;
 signerKeyFingerprint: string;
 signedAt: string;
 signature: string;
};
```

The event body is type-specific. For example, `container.grant` includes the
subject principal, access level, current referenced principal policy head, and
the container manifest hash being advanced. `document.link` includes the
document manifest hash and target container manifest hash. `attachment.bind`
includes document id, [slot](../glossary/content.md#attachment-slot) id, blob id,
expected binding id, and document manifest hash. Attachment events use
`objectKind: "blob"` when they advance the blob target/binding manifest; the
attachment-specific identity lives in the event body, not in a separate fourth
manifest kind.

### Manifest Shape

An access manifest is a canonical snapshot derived from events:

```ts
type ReferencedPrincipalHead = {
 principalType: "group" | "organization";
 principalId: string;
 version: number;
 keyEpoch: number;
 stateHash: string;
 keyFingerprint: string;
};

type AccessManifest = {
 version: 1;
 objectKind: "container" | "document" | "blob";
 objectId: string;
 organizationId: string;
 epoch: number;
 previousManifestHash: string | null;
 eventHash: string;
 structuralHash: string;
 grantRoot: string;
 referencedPrincipalHeads: ReferencedPrincipalHead[];
 keyTargetHash: string;
};

type AccessManifestHash = string;
```

`AccessManifestHash` is the digest of the canonical serialization of
`AccessManifest`. It is stored and referenced beside the manifest, not inside
the manifest payload being hashed.

Clients verify:

- event signatures;
- signer identity key authenticity;
- signer authorization against the previous manifest;
- referenced group/organization policy chains;
- cross-object dependencies, such as parent container, linked container, or
 active attachment binding heads;
- monotonic local checkpoint rules;
- optional transparency inclusion and consistency proofs.

This turns "the API returned a self-consistent grant view" into "the API
returned a verifiable signed state transition."

### Container Access Manifests

A container access manifest is the signed head for the container's direct
access and structural parent edge. It does not contain an expanded recipient
list for every descendant document.

Container manifest inputs:

- container id and organization id;
- parent container id and parent manifest hash;
- authoritative metadata document id for the container;
- direct grants on this container;
- referenced principal policy heads for direct managed-principal grants;
- current container KEK epoch id;
- previous container manifest hash;
- authorizing signed event hash.

A container's [effective access](../glossary/access.md#effective-access) is
derived by walking ancestor container manifest heads and unioning their direct
grants. For runtime efficiency, the server may materialize ancestor paths and effective
grant summaries, but a client can verify the path from signed manifest hashes.

Scaling rule: sharing or revoking a container must not rewrite every
descendant container manifest. Descendants inherit through their parent edge and
their parent KEK wrap. A descendant manifest changes only when that descendant's
own direct grants, parent edge, or key epoch changes.

### Document Link-Set Manifests

A document link-set manifest is the signed head for the set of containers that
currently link to a document. It is not a per-container access manifest and it
does not expand users.

Document link-set inputs:

- document id and organization id;
- active linked container ids;
- dependency container manifest hashes used to authorize the link/unlink event;
- previous document link-set manifest hash;
- authorizing signed event hash.

`document.link` and `document.unlink` events advance only this link-set head.
They do not copy container grants into the document and they do not mutate
container manifests.

The document's write targets are derived at write time:

1. verify the document link-set manifest;
2. load and verify each active linked container's current manifest head;
3. resolve each linked container's current container KEK epoch;
4. sort and hash those [KEK targets](../glossary/keys.md#key-target).

So a container grant change does not cause writes to thousands of document
link-set manifests. Existing documents see the new container KEK state
when their next write target set is derived.

### Derived Document Access Views

A document access view (`VerifiedDocumentKekTargets`) is a deterministic
projection:

```ts
type VerifiedDocumentKekTargets = {
 documentId: string;
 linkSetManifestHash: string;
 linkedContainerManifestHashes: string[];
 linkedContainerKeyEpochIds: string[];
 targets: DocumentContentKeyTarget[];
 documentKeyTargetHash: string;
};
```

The API can cache, index, and return this view, but it is not the authority.
Clients recompute and verify it from signed manifests before using it to
encrypt.

Blobs follow the same pattern: blob access is a view derived from signed active
attachment binding events plus the linked documents' verified target sets.

## Authorization Rules

- `container.create`: signer must have write access to the parent container.
- `container.grant` / `container.revoke`: signer must have admin access to the
 container.
- `container.rekey`: signer must have current write access to the container and
 may only advance the KEK epoch for an already-authorized manifest. It cannot
 change grants, parentage, or linked objects.
- `container.move`: signer must have admin access to the moved container and
 write access to the destination parent; the event references both manifest
 heads.
- `document.link`: signer must have write access to the document through at
 least one current linked container and write access to the target container.
- `document.unlink`: signer must have write access to the document through at
 least one remaining linked container and write or admin access to the
 unlinked container.
- `attachment.bind` / `attachment.detach`: signer must have write access to the
 document under the current document manifest.

These rules treat link as additive and unlink as potentially subtractive. A
writer who can edit the document can already disclose its plaintext through
ordinary edits, so requiring write access through every linked container would
add friction without preventing a meaningful confidentiality attack. Unlink is
stricter because it can remove another container's future access path.
