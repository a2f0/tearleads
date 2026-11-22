# Advisory Op Spans

Each [encrypted document update](./glossary/content.md#loro-update) declares, in
visible [version-vector](./glossary/content.md#version-vector) spans its writer
signs, the operations it carries. The server indexes and filters pulls by those
spans (see [the Loro sync protocol](./loro-e2ee-sync-protocol.md#protocol-shape)),
but only a reader can check them against the payload. This page describes what
readers and the server do when a span is false (#3135).

## What the Server Checks

The server refuses (400) a span that is empty or inverted, and an encrypted
envelope whose record id, content-key epoch, metadata hash, or nonce domain
differs from its signed write header. No honest client sends either. It stores
any other span as declared.

## Void Updates

A reader judges each served update in server order. It decrypts the update,
checks the plaintext hash, decodes the Loro metadata, and imports the update
into its history plus every update it accepted before. An update is a
[void update](./glossary/content.md#void-update) when its decoded span is not
its declared one, its decoder cannot read it, or its dependencies are on no
earlier accepted update. The reader records it in `document_void_updates`,
reports it once as `Documents: sync update voided`, and goes on. A void never
fails the pass or sets the document's sync failure. An AES-GCM failure stays an
availability failure, because a reader cannot prove its content key is the one
the writer used.

## The Processed Cursor

Every page returns `pullPage.throughUpdateId`, the last update committed when
the pull began. After the last page, the reader stores that id as its
[processed cursor](./glossary/sync.md#processed-cursor), with the frontier it
reached and its judge (the void-rules version and the Loro decoder version).
Its next pull sends the cursor as `processedThroughUpdateId`. The server then
starts the pull after the cursor's commit position, never past the pull's upper
bound, so a void update is served once instead of on every pull. An id that is
not an update of this document is ignored. A cursor needs a non-null
`localVersionVector`, so a raw-history pull carries none.

The reader withholds its cursor, and the next pull judges everything its
frontier does not cover again, when:

- its judge changed, so a newer decoder reads what an older one voided;
- its frontier no longer covers the one recorded with the cursor, as after its
  state is replaced;
- a void was judged under a different content key for its epoch than the one it
  now holds.

Rebinding or deleting the local record drops its cursor and void rows.
Rotation's raw history and a founding update still fail on any void, because
they re-encrypt or verify a history that must be whole.
Container metadata documents void the same way but keep no cursor. Attachment
binds, rotation, unlink, and raw-history recovery still compare declared spans.
[`VoidUpdateProgress`](../formal/document-sync/VoidUpdateProgress.md) checks
that no void update is applied, that readers agree, and that a reader stays
current.
