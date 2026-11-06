# Protocol Specification: Foundations

Part of the [protocol specification](../protocol-specification.md).

## Goals

- Keep document and [blob](../glossary/content.md#blob) plaintext opaque to the
  server.
- Make access and [key-target](../glossary/keys.md#key-target) state
  client-verifiable.
- Bind every encrypted content record to a
  [signed write header](../glossary/content.md#signed-write-header).
- Bind every structural access mutation to a signed
  [access event](../glossary/access.md#access-event) and derived manifest.
- Keep blob attachment state server-indexable without exposing document
  plaintext.
- Let the app fail closed when required cryptographic policy material is
  missing, stale, or inconsistent.

## Protocol Planes

The protocol has three adjacent planes:

- [Document plane](../glossary/content.md#document-plane): encrypted
  [Loro updates](../glossary/content.md#loro-update) plus visible causal metadata.
- [Attachment plane](../glossary/content.md#attachment-plane): blob staging plus
  signed attachment bind/detach metadata.
- [Access plane](../glossary/access.md#access-plane): signed
  [principal policies](../glossary/principals.md#principal-policy-state),
  [access manifests](../glossary/access.md#access-manifest),
  [container KEKs](../glossary/keys.md#container-kek),
  [content-key bundles](../glossary/keys.md#content-key-bundle), and write headers.

The planes are separate but not independent. A document sync write needs access
proofs and content-key targets. A blob bind needs a staged encrypted blob,
attachment metadata, access proofs, blob content-key targets, and a blob write
header.

## Common Cryptographic Objects

Signed access events have this logical shape:

```ts
type AccessEvent = {
  version: 1;
  eventId: string;
  eventType:
    | "attachment.bind"
    | "attachment.detach"
    | "container.create"
    | "container.grant"
    | "container.move"
    | "container.recite"
    | "container.rekey"
    | "container.revoke"
    | "document.link"
    | "document.purge"
    | "document.unlink";
  objectKind: "blob" | "container" | "document";
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

Access manifests commit to the derived state for a container, document link
set, or blob target set:

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
  objectKind: "blob" | "container" | "document";
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
```

Write headers commit encrypted content records to the object, access
[head](../glossary/sync.md#head), [key epoch](../glossary/keys.md#epoch), target
set, ciphertext hash, metadata hash, nonce domain, and writer identity:

```ts
type WriteHeader = {
  version: 1;
  organizationId: string;
  objectKind: "blob" | "document";
  objectId: string;
  accessManifestHash: string;
  dependencyManifestHashes: string[];
  contentKeyEpoch: number;
  targetHash: string;
  encryptionSuite: "aes-256-gcm-hkdf-sha256-record-key";
  contentRecordId: string;
  nonceDomainHash: string;
  metadataHash: string;
  ciphertextHash: string;
  writerUserId: string;
  writerDeviceId: string;
  writerKeyFingerprint: string;
  signedAt: string;
  signature: string;
};
```

The header's `dependencyManifestHashes` is the sorted, unique union of all
manifest hashes in the complete
[authorizing container paths](../glossary/access.md#authorizing-container-path).
Submission must cite the verified current paths; historical reads rebuild those
exact signed paths and use referenced group membership. The API retains the
dependencies of retained document and blob headers for fresh-device
verification. All signed timestamps use the exact UTC `Date.toISOString()`
representation.

The API treats route JSON as untrusted input until the shared verifiers produce
branded verified values. The app applies the same discipline before persisting
[writer projections](../glossary/sync.md#writer-projection), accepting response
key material, or decrypting content.
