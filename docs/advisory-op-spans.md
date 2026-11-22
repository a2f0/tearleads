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

A reader judges each served update in server order. It decrypts the update
and checks the plaintext hash; then its import judge, the only code that reads
a payload with Loro, decodes the Loro metadata and imports the update into its
history plus every update it accepted before. An update is a
[void update](./glossary/content.md#void-update) when its decoded span is not
its declared one, its decoder cannot read it, or its dependencies are on no
earlier accepted update. The reader records it in `document_void_updates`,
reports it once as `Documents: sync update voided`, and goes on. A void never
fails the pass or sets the document's sync failure. An AES-GCM failure stays an
availability failure, because a reader cannot prove its content key is the one
the writer used. A sync pass whose judge (`validateIncomingUpdates`) returns
no verdicts fails, rather than applying updates nobody judged.

A void whose import changed the scratch history the reader judges against
forces it to rebuild that history before the next update. Each page may spend
at most 32 MiB of rebuilt snapshot and update bytes; once the budget is spent,
the reader leaves the page's remaining updates unapplied, reports the pull
incomplete, and drops the page's continuation, so its next pull serves them
again. Voids that change nothing (a counter gap read from the update's
metadata, a collision with operations already held, an undecodable payload)
cost no rebuild. An update this device already voided at a stage the import
judge decides, under the same judge and the same content key, stays void
without another Loro call, so every pass judges at least one update the last
one did not.

## Loro Runtime Failures

A WebAssembly trap (a Rust panic, or an allocation that aborted) or a
`RangeError` while the import judge reads a payload is no verdict about the
update: an honest update can exhaust memory, and a trap can leave the module
unusable for the rest of the process. Such an update is unsettled. The reader
records it at stage `loro_runtime` with an attempt count, in its own
transaction before anything else touches Loro, and holds it and every update
after it on the page: the pass applies what came before, records no cursor,
keeps the remote-update signal pending, and does not pull again at once. A
later pull judges the update again; like a parked sync failure, it waits for
the next edit, remote hint, reconnect, start, or refresh rather than a timer.
In the same process it waits out a retry delay (one minute, doubling to an
hour) and is not read in the meantime. Rotation and a founding view judge
updates without recording attempts: a runtime failure there fails that
operation, counts toward no update, and still marks the process as failed.

Only the first runtime failure in a process counts as an attempt, because a
later one may be the module's state, not the update. Once three process
lifetimes have each failed the update, it is a final void like the others, is
reported as such, and is never read again under that judge and key. A new
decoder or another content key judges it from zero. An update that imports on
a retry joins.

Two residuals remain. An honest update that fails the runtime in three
separate process lifetimes on one device is void on that device. And while an
update is unsettled, the device applies nothing served after it on that
document and cannot bind attachments to it, for up to three process
lifetimes; its own writes still push and settle. A payload that kills the
process outright, rather than throwing, records no attempt.

## Preempted Operations

Earliest-wins voids the later of two updates that carry the same operation ids
(peer and counter) with different operations. A writer that commits operations
under another device's peer id at that device's next counters, before the
device's own update lands, therefore makes every reader void the device's
update. This is an accepted residual of #3135; the server does not yet tie a
peer id to the writer that may use it. Before advisory spans, one such forged
collision stopped every reader's sync of the document; now it drops the
preempted operations on other readers.

A device that is served such an update holds its own operations first, so it
voids the forger's update instead. When that void reuses ids under the peer id
the device writes with, it records a notice in `document_peer_preemptions` and
reports once which writer (user and key fingerprint) signed the update. For a
rotation baseline that is the writer that relayed the operations, not
necessarily the one that forged them. A forger that declares exactly the
counters the device already holds is not served to that device, because the
device's frontier covers the declared span, so the notice catches only a
forgery the device is served.

## The Processed Cursor

Every page returns `pullPage.throughUpdateId`, the last update committed when
the pull began. After the last page, the reader stores that id as its
[processed cursor](./glossary/sync.md#processed-cursor), with the frontier it
reached and its judge (the void-rules version and the Loro decoder version).
Its next pull sends the cursor as `processedThroughUpdateId`. The server then
starts the pull after the cursor's commit position, never past the pull's upper
bound, so a void update is served once instead of on every pull. An id that is
not an update of this document is ignored. A cursor needs a non-null
`localVersionVector`, so a raw-history pull carries none. A first page that
starts after a cursor still goes straight to the latest readable rotation
baseline when the baseline covers every update between the cursor and it.

The reader withholds its cursor, and the next pull judges everything its
frontier does not cover again, when:

- its judge changed, so a newer decoder reads what an older one voided;
- its frontier no longer covers the one recorded with the cursor, as after its
  state is replaced;
- a void was judged under a different content key for its epoch than the one it
  now holds.

A pull of several pages advances the cursor only if every page after the first
went out under the judge and the cursor its first page was sent with. The
server keeps serving after the continuation, so a pull whose later pages ran
under a newer decoder, or after its cursor was dropped, never judged what that
cursor skipped. Such a pull leaves the cursor as it was, and the next pull goes
by version alone.

A cursor also makes a server's omission durable: an update left out of a
completed pull is not served to that device again until its cursor is
withheld. Before the cursor, the next version pull served it.
[Withholding](./security-guarantees/boundaries.md#availability-is-out-of-scope)
is outside the guarantees either way.

Rebinding or deleting the local record drops its cursor, void rows, and
preemption notices.
Rotation's raw history still fails on any void, because it re-encrypts a
history that must be whole, and a founding view whose first update is void
shows no founding update.
Container metadata documents void the same way but keep no cursor, so every
pull of one judges its voids again (each is still reported once), and a folder
listing whose advertised version an overclaim left uncovered keeps that folder
marked as behind. Attachment
binds, rotation, unlink, and raw-history recovery still compare declared spans.
A rotation baseline must cover the committed frontier its updates declare, so
after an overclaim an honest rotation's baseline is refused, and a first page
goes straight to a baseline only when the baseline covers every update it
would skip.
[`VoidUpdateProgress`](../formal/document-sync/VoidUpdateProgress.md) checks
that no void update is applied, that readers agree, that a reader stays
current, and that a runtime failure voids an update the decoder can read only
after the bounded attempts.
