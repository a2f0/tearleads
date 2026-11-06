# Glossary: Documents And Attachments

Part of the [glossary](../glossary.md).

## Attachment Binding

A server-visible signed relationship between a [document slot](#attachment-slot)
and a [blob](#blob). Active bindings are the authority for attachment listing,
blob reachability, blob read access, replacement, and detach behavior.

Related docs:

- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md#attachment-semantics)
- [protocol-specification.md](../protocol-specification/blobs.md#attachment-bind-replace-detach-and-slots)
- [attachment-retention.md](../attachment-retention.md)

## Attachment Plane

The protocol plane for encrypted [blob staging](#blob-stage) and signed
[attachment bind/detach](#attachment-binding) metadata. Attachment metadata
stays server-indexable even though blob bytes and document content remain
encrypted.

Related docs:

- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md)
- [api-architecture.md](../api-architecture.md#protocol-planes)

## Attachment Slot

An opaque stable identifier inside a [document](#document), such as a
product-level "front image" or "back image" slot. The protocol only treats it as
a `slotId`; at most one [active binding](#attachment-binding) may occupy a slot
at a time.

Related docs:

- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md#why-slotid-instead-of-bindingid)
- [protocol-specification.md](../protocol-specification/blobs.md#attachment-bind-replace-detach-and-slots)

## Blob

An encrypted binary object stored separately from
[document CRDT updates](#loro-update). Blob access is derived from active
[signed attachment bindings](#attachment-binding) and the linked
document/container access graph.

Related docs:

- [access-plane.md](../access-plane.md#blobs)
- [protocol-specification.md](../protocol-specification/blobs.md#blob-read-protocol)

## Blob Stage

A temporary holding record for [encrypted blob bytes](#blob) before an
[attachment bind](#attachment-binding) promotes them to committed blob storage.
The server validates byte length, digest, ownership, and expiry, but does not
decrypt the bytes. Stages are multipart uploads that the attachment bind
assembles and verifies.

Related docs:

- [protocol-specification.md](../protocol-specification/blobs.md#blob-stage-protocol)
- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md#protocol-shape)

## Document

An encrypted CRDT object whose plaintext is opaque to the server. Documents do
not own direct ACLs. Access is resolved through their
[signed link-set manifest](./access.md#document-link-set-manifest) and the active
[linked container paths](./access.md#authorizing-container-path).

Related docs:

- [access-plane.md](../access-plane.md#documents)
- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md#reference-model)

## Document Plane

The protocol plane for [encrypted Loro updates](#loro-update) plus visible
causal metadata. The server indexes and relays encrypted updates but does not
decrypt document content.

Related docs:

- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md)
- [api-architecture.md](../api-architecture.md#protocol-planes)

## Loro Update

An encrypted CRDT update produced by the Loro document layer. The server can see
causal metadata such as [version-vector spans](#version-vector), but the update
payload remains encrypted with the [document content key](./keys.md#content-key).

Related docs:

- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md)

## Signed Write Header

A signed commitment that binds an [encrypted document update](#loro-update) or
blob record to the object id, [access manifest hash](./access.md#access-manifest),
content-key epoch, [target hash](./keys.md#target-hash), metadata hash,
ciphertext hash, nonce domain, writer identity, and encryption suite.

Related docs:

- [protocol-specification.md](../protocol-specification/foundations.md#common-cryptographic-objects)
- [keying-design.md](../keying-design/content-keys.md#content-write-authorization)

## Version Vector

Visible causal metadata for Loro sync. Clients submit their local frontier, and
the server uses stored update spans to return [encrypted updates](#loro-update)
not covered by that frontier.

Related docs:

- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md#protocol-shape)
