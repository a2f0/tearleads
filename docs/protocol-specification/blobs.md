# Protocol Specification: Blobs And Attachments

Part of the [protocol specification](../protocol-specification.md).

## Blob Stage Protocol

Blob bytes are staged before attachment binding:

- `POST /blobs/stages/multipart`
- `GET /blobs/stages/multipart/:stageId`
- `POST /blobs/stages/multipart/:stageId/parts/:partNumber/upload`
- `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes` (non-signing stores)

`InitiateMultipartBlobStageRequest` declares the completed encrypted object's
`organizationId`, `byteLength`, and `sha256`, plus `firstParts`: the number,
exact byte length, and base64 Content-MD5 of each part the client sends first
(one to four, its upload concurrency). The caller must have direct
organization access. Before creating any upload, the API refuses first parts
that repeat a number, exceed the declared object alone or together, or (on
S3/R2) name a part number the declared size cannot reach with 5 MiB parts.
The response's `partUploads` carries one upload source per first part, so the
parts the client starts at once need no authorization request of their own.
Later parts, and a renewal after a URL expires or fails, are authorized one at
a time with the same byte length, Content-MD5, and upload ID. S3/R2 sources are
five-minute UploadPart URLs scoped to the stored key, upload ID, part number,
checksum, and exact byte length; the client sends
`application/octet-stream` directly to storage and confirms the returned ETag.
URL expiry never invalidates uploaded parts or extends the one-hour stage.
Non-signing stores answer every part with the API byte route (`kind: "api"`),
so their clients never authorize a part; S3/R2 reject that proxy path before
reading a body.

There is no completion request. Attachment binding completes the stage: before
its transaction it assembles parts 1..k of the stage's upload, the run whose
stored lengths add up to exactly the declared byte length, and verifies the
object's length and SHA-256 against the stage, deleting a mismatched object and
refusing with `409`. A part numbered past that run is left out, so a stray part
cannot change the object. No uploaded parts, a gap (the 409 names its first
missing part), or parts that miss the declared length are refused before the
upload is consumed, so that part can still be sent. Completion is idempotent: a
stage already complete is used as is, and an object assembled before a lost
state flip is re-verified before it is adopted. A bind that finds the upload
consumed and no object re-reads the stage: if a concurrent bind has marked it
complete, that object is verified and used. The stage is marked complete once
the digest matches, before the envelope header is judged, so a malformed
envelope is refused (`400`) with the stage left complete, and a retry is refused
the same way.

The API stores only object-store multipart metadata in `blob_stages`; encrypted
payload bytes are never encoded into JSON or stored in the database. Staged
objects are not readable as committed blobs and are promoted only by a
successful attachment bind. Expired stages, and stages whose parts do not
assemble to the declared object, fail closed during bind.

Object keys are `organizations/<organizationId>/blob-stages/<stageId>` and
remain unchanged after promotion. The stage's immutable organization must match
the destination document's verified organization, even when the uploader belongs
to both organizations. Initiation and status responses include
`organizationId`; clients check it before resuming an upload.

GC retains the full key and organization in durable deletion work, checks their
agreement before object deletion, and retries that exact key after a failure.
Expiry cleanup uses the stored stage key for both multipart aborts and completed
object deletion. Organization purge expires and drains only its own stages and
waits for stage cleanup before finalizing. Stage persistence rechecks
organization access under the organization row lock after object-store
initiation, so a purge that wins that race causes the new multipart upload to be
aborted.

A client replacing a persisted resume stage must require positive API proof:
`GET /blobs/stages/multipart/:stageId` returns
`404 multipart_blob_stage_not_found` when the stage or its object-store upload
or completed staged object is absent, and
`409 multipart_blob_stage_expired` when the stage expired. Only those exact
status-and-code pairs permit opening a fresh stage. Uncoded, malformed, unknown,
cross-status, proxy, route, and unrelated conflict failures are terminal so the
client does not abandon resumable state on an ambiguous error.
If a bind consumed the multipart upload but its completion write was lost, the
status lookup revalidates the surviving staged object, converges the stage to
complete, and returns it instead of emitting absence.

## Attachment Bind, Replace, Detach, And Slots

Attachment slots are opaque stable identifiers inside a document. Product code
may treat a slot as "front image" or "back image", but the protocol only sees a
`slotId`. A document slot has at most one active binding. A same-slot
replacement signs a new `attachment.bind` event whose `expectedBindingId`
matches the active binding being replaced.

Binding uses:

- `POST /blobs/:blobId/attachment-bindings`

`BlobAttachmentBindRequest` carries:

- signed `attachment.bind` event and body
- `authorizingContainerPathRefs` citing stored container manifests; the API
  resolves the document manifest from its own store
- optional `containerRekeys[]`
- [blob content-key bundle](../glossary/keys.md#blob-content-key-bundle)
- optional `stagedBlob` with `stageId` and signed blob write header
- optional `documentSync`: the document's deferred first update, held to the
  same shape as a create's `initialSync` seed (one outgoing update from an
  empty start, no container rekeys, within the sync request limit)

The bind body commits to `bindingId`, `blobId`, `documentId`, `slotId`,
`expectedBindingId`, and `documentManifestHash`. The event uses
`objectKind: "blob"` and dependency manifest hashes for the document and linked
container access heads.

For bind, the API verifies:

- session user/fingerprint match the event signer
- document manifest and authorizing paths are active heads
- referenced principal policies resolve and verify
- expected previous binding matches the active slot binding
- staged blob owner and expiry when `stagedBlob` is supplied
- existing blob presence when no staged blob is supplied
- submitted blob content-key targets and their hash match only the new binding's
  current derived KEK targets; any other binding in the submission is refused
- staged blob write header matches blob id, blob access manifest hash,
  content-key epoch, [target hash](../glossary/keys.md#target-hash), `ciphertextHash`
  matching the staged SHA-256, and writer identity

After verification, the API promotes staged bytes when supplied, detaches the
previous active slot binding if present, stores the new binding, persists blob
content-key targets merged with the exact stored envelopes of all other bindings
under the blob row lock, recomputes the merged target hash, stores the blob
write header, registers the blob in `blob_audit_objects`, and touches the
document plus linked containers for sync discovery.

`BlobAttachmentBindResponse` acknowledges by hash: the binding identity,
`previousBindingId`, `documentManifestHash`, the signed event's `eventHash`,
the stored `contentKeyEpoch`, the stored write header's `writeHeaderHash`, and
the hashes of the resolved KEK targets, `blobKeyTargetHash`, and blob access
manifest, `blobAccessManifestHash`. The client compares each with what it
signed; the access manifest hash commits to the blob's organization, active
bindings, document manifests, and linked container manifests and KEKs, so a
match proves the server resolved exactly the targets the client wrapped to. The
[realtime hint](../developer/realtime-hints.md) names the containers of the
targets the API resolved.

When the request carries `documentSync`, the API then commits it in the same
transaction, after the binding row, under every check a standalone sync makes
(write header, target and link-set expectations, billing, minimum commit
position). The bind writes no
[link-set manifest](../glossary/access.md#document-link-set-manifest), so the update's
`expectedLinkSetManifestHash` is checked against the head the bind locked. A
`documentSync` the sync route would refuse fails the whole bind. To keep the
global container head -> document head -> blob row lock order, a bind carrying
`documentSync` locks the document head `FOR UPDATE` (instead of `FOR SHARE`) and
the update's authorizing container heads before any blob row, and the update's
write refuses with `409` rather than lock a head the bind did not already hold.
The response's `documentSync` names the accepted update ids, the commit position
read after commit, and its mode, as a create's `initialSync` does; the bind's
[realtime hint](../developer/realtime-hints.md) names the update ids. Explorer
import sends the document's held-back first update this way when its create and
its only attachment's bind run in one pass. The client settles its queued row
only when the acknowledgement names it; a bind refused with `400`, `403`, `404`,
or `409` is sent once more without `documentSync`, and the row then syncs on its
own. A lost response leaves the row queued; binding adoption by slot and
update-id recovery are unchanged.

Detach uses:

- `POST /blobs/:blobId/attachment-bindings/:bindingId/detach`

`BlobAttachmentDetachRequest` carries the signed `attachment.detach` event and
body, `authorizingContainerPathRefs`, and optional `containerRekeys[]`. The API
verifies the active binding, signed event, document manifest, authorizing paths,
and referenced principal policies before detaching the binding.

Each encrypted Loro attachment entry carries its slot ID and required lowercase
SHA-256 `contentSha256` of the intended plaintext. Local attachment creation and
replacement author this digest before staging; resumable uploads verify their
source against it. Hydration verifies the signed binding and ciphertext, then
checks the decrypted plaintext against the current authenticated document entry.
An older valid binding with different content remains unavailable and cannot
replace locally held bytes. A mismatch alone is not tampering evidence: the
current document can arrive before its new blob upload.

Hydration commits only while its document intent is still current and the
durable slot still names the local copy observed before downloading. SQLite
compares the slot inside the guarded transaction; a competing facade's
replacement is retained. Replaced bytes enter the reference-checked orphan
reclaim queue. Signed attachment binding metadata remains the server-visible
authority for blob access, attachment listing, replacement, detach, and live
blob reachability.

## Blob Read Protocol

Blob reads use:

- `GET /documents/:documentId/attachments`
- `GET /blobs/:blobId/download`
- `GET /blobs/:blobId/bytes`

Attachment listing requires document read access through a linked container path
and returns one row per active binding: its `bindingId`, `blobId`, `slotId`,
signed binding event, blob write header and authorization, KEK targets, and
`contentKeyBundle`. The content-key bundle is loaded from the blob key-package
tables, not from the encrypted blob bytes. Blob reads require read access
through at least one active binding's document. The download route returns the
blob id, byte length, and SHA-256 plus a `source`: a five-minute signed
object-store URL, or `kind: "api"` when the store cannot sign. The `/bytes`
route streams committed encrypted bytes as `application/octet-stream` with blob
id, byte length, and SHA-256 digest headers. The app combines the attachment
listing's blob content-key bundle with verified document/container access
material to unwrap the blob [content key](../glossary/keys.md#content-key) and decrypt
the committed bytes.

The stored blob wrap set and current access-target projection are distinct.
Container rotation does not rotate immutable blob ciphertext: a cold reader may
use a retained KEK from the verified current keyring to open an older envelope.
Each envelope's container manifest and KEK identity must resolve through signed
history. Signed blob write authority and binding history are verified
separately. The API retains prior envelope sets by target hash; updating the
latest set never deletes an issued historical wrap. Link/unlink events carry
signed `blobRewraps` and atomically install destination envelopes with the
document's new links (see
[document link protocol](../document-link-and-sync-protocol.md)).

Attachment hydration isolates individual download and verification failures so
one unavailable or invalid binding cannot suppress unrelated attachments.
Typed verification failures reach the security reporter. Database closure and
projection-generation cancellation still abort the whole hydration operation.
