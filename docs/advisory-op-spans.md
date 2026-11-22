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

A void whose import changed the scratch history the reader judges against
forces it to rebuild that history before the next update. Each page may spend
at most 32 MiB of rebuilt snapshot and update bytes; once the budget is spent,
the reader leaves the page's remaining updates unapplied, reports the pull
incomplete, and drops the page's continuation, so its next pull serves them
again. Voids that change nothing (a counter gap read from the update's
metadata, a collision with operations already held, an undecodable payload)
cost no rebuild. An update this device already voided at the import stage,
under the same judge and the same content key, stays void without another
import, so every pass judges at least one update the last one did not.

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
Rotation's raw history still fails on any void, because it re-encrypts a
history that must be whole, and a founding view whose first update is void
shows no founding update.
Container metadata documents void the same way but keep no cursor, so every
pull of one judges its voids again (each is still reported once), and a folder
listing whose advertised version an overclaim left uncovered keeps that folder
marked as behind. Attachment
binds, rotation, unlink, and raw-history recovery still compare declared spans.
[`VoidUpdateProgress`](../formal/document-sync/VoidUpdateProgress.md) checks
that no void update is applied, that readers agree, and that a reader stays
current.
