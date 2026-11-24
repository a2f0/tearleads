# Advisory Op Spans

Each [encrypted document update](./glossary/content.md#loro-update) declares, in
visible [version-vector](./glossary/content.md#version-vector) spans its writer
signs, the operations it carries. The server indexes and filters pulls by those
spans (see [the Loro sync protocol](./loro-e2ee-sync-protocol.md#protocol-shape)),
but only a reader can check them against the payload. This page describes what
readers and the server do when a span is false (#3135).

## What the Server Checks

The server refuses (400) a span that is empty or inverted, an encrypted
envelope whose record id, content-key epoch, metadata hash, or nonce domain
differs from its signed write header, and an envelope that does not name its
epoch's [content-key commitment](./glossary/keys.md#content-key-commitment). No
honest client sends any of them. It stores any other span as declared.

It also ties each peer to the user that may extend it (#3194). A peer's
committed frontier is the highest declared span end on it. Under the document
lock, the server walks a request's new updates in request order, raising each
frontier as it goes. A span ending at or below the frontier re-asserts
committed counters, which any writer may do. A span past it claims an unowned
peer for the writer's user, who becomes its
[peer owner](./glossary/sync.md#peer-owner); passes on a peer that user owns;
and is refused on a peer another user owns. A refusal rolls the whole request
back with 409 `document_sync_peer_owned`, whose `peerFrontiers` name at most
64 refused peers in canonical order, each with the frontier committed before
the request. Update ids the document already holds are retries and are not
judged again. A rotation baseline is judged the same way whether a sync or an
unlink carries it, so it may re-assert every user's peers but extend only its
writer's; the unlink's refusal carries the code without `peerFrontiers`. A
purge deletes the owner rows with the spans. Peers committed before the rule
were backfilled to the user of their first update, or to the nil id, which no
user has, when that author names no user. The rule is modeled in
[`PeerOwnership.tla`](../formal/document-sync/PeerOwnership.md).

## Void Updates

A reader judges each served update in server order. It checks the envelope
against the signed header, then that the content key it holds is the one the
envelope commits to, decrypts the update, and checks the plaintext hash; then
its import judge, the only code that reads a payload with Loro, decodes the Loro
metadata and imports the update into its history plus every update it accepted
before. An update is a [void update](./glossary/content.md#void-update) when
AES-GCM or the plaintext hash fails under the committed key, its decoded span is
not its declared one, its decoder cannot read it, its dependencies are on no
earlier accepted update, or it carries other operations under ids the reader
already holds. That comparison replays both copies of the operations onto one
history first, so the runs an import happened to split them into never make an
honest update void: a checkpoint completing a change the reader holds part of is
accepted. The reader records it in `document_void_updates`, reports it once as
`Documents: sync update voided`, and goes on. A void never fails the pass or
sets the document's sync failure. A reader whose key is not the committed one
records no verdict for the update: that is an availability failure, and the pass
fails as an unwrap failure does. So is a failure of its own runtime while it
derives keys or decrypts, including an AES-GCM refusal when the reader cannot
round-trip a canary of the record's size under the same key (stage
`decrypt_runtime`). A sync pass whose judge (`validateIncomingUpdates`) returns
no verdicts fails, rather than applying updates nobody judged.

A void whose import changed the scratch history the reader judges against
forces it to rebuild that history before the next update. Each page may spend
at most 32 MiB of rebuilt snapshot and update bytes; once the budget is spent,
the reader leaves the page's remaining updates unapplied, reports the pull
incomplete, and drops the page's continuation, so its next pull serves them
again. Voids that change nothing (a counter gap read from the update's
metadata, a collision with operations already held, an undecodable payload)
cost no rebuild. An update this device already voided at a stage the import
judge decides, under the same judge, stays void without another Loro call, so
every pass judges at least one update the last one did not.

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
So does a runtime failure while the judge builds the reader's own history
(the page is held whole) or while a judged page is applied to the live
document.

Only the first runtime failure in a process counts as an attempt, because a
later one may be the module's state, not the update. Once three process
lifetimes have each failed the update, it is a final void like the others, is
reported as such, and is never read again under that judge. A new decoder
judges it from zero. An update that imports on a retry joins.

A payload can also kill the process outright (an out-of-memory crash, or a
renderer crash) rather than throw. Document sync reads a page inside a read
window: a local row naming the page's unsettled updates, committed once the
reader's history is built, before the first update is read, and deleted by the
page's save. Each process lifetime holds a Web Lock named after it, so the
next lifetime knows a window whose lock is gone was left by a dead one. A
window that held one update, in a lifetime that met no runtime failure,
records one `loro_runtime` attempt toward it, so a killing payload is voided
after three deaths. Any other window says nothing about one update: its
updates become suspects, and the document pulls one update a page
(`maxPageUpdates: 1`) until it has passed them, so a later death names the
update alone. Documents sync in parallel, so a window counts only while it is
its lifetime's only open one: opening a second stops every window of that
lifetime counting, in every database it has open, and a death then isolates
them all. Each sync pass holds a window of its own and settles only that one,
so a stale pass still running after the store moved to another database
cannot close the window of the pass that replaced it. Container metadata,
rotation (its raw history, and the sync that settles queued edits first), and
a founding view read served updates in windows of their own, claimed and
isolated the same way; a rotation or founding window closes once its Loro work
on the page is over, since it saves no page. A rotation's raw-history window
charges a death to the rotation instead of an update (below). A window the
process outlives, closed by a save or settled without one, clears the
`loro_runtime` attempts earlier deaths and failures counted toward the updates
it read, except one the runtime failed on inside it: the process read them and
lived, so those deaths were not theirs, and deaths months apart never add up
to a void. A final void stands. Every read of served updates is
then inside a window. A caller of the import judge that opens none, as a host
calling it directly may, marks the lifetime failed once it reads an update, so
its death counts toward no update. A document isolating suspects waits to read
until its window would be the lifetime's only one;
after 30 seconds it reads beside the others, and counts nothing. A lifetime
that ends while the app is hidden, with a window open, leaves a `localStorage`
marker, and its window counts nothing and isolates nothing: the user closed
the app, which says nothing about the update. A lifetime that met a runtime
failure anywhere, with a window open, leaves a marker too, and its window
isolates instead of counting, since the module may be unusable. A lifetime
that cannot delete a window's row keeps its failure marker too, so its death
isolates that row's updates. A host that cannot keep these markers (no working
`localStorage` or page visibility) opens windows that count nothing, since a
close could not be told from a death; a death there isolates. A lifetime's
markers stay until a claim finds none of its windows left in the database.
A lifetime that could not settle a window keeps them for good, since its
windows may stand in a database that claim cannot see. A host without
Web Locks, or whose lock request is refused, opens no window. The command
line's database is memory-only, so its windows die with it; a host whose
database outlives its process must hold such a lock or mark its clean exits.

Five residuals remain. An honest update that fails the runtime, or ends the
process while the app is visible, in three separate process lifetimes on one
device, with no read of it the process outlived between them, is void on that
device. A window opens once the reader's history is
built and closes with the page's save, which imports the update, so a visible
death inside it counts toward the update whatever caused it: Loro work on
local or accepted data the process runs meanwhile (the editor, a live apply,
another document's reader history being built), the document's own size while
saving, or a killer read by another tab that shares the browser process. A
claim counts at most one attempt per update, so
tabs that die together in one browser process count one. While an update is
unsettled, the device applies nothing served after it on that document and
cannot bind attachments to it, for up to three process lifetimes; its own
writes still push and settle. The live apply after a page's save opens no
window, so a payload that kills the process there records no attempt.

And a founding view reads history the device already accepted, so the
deaths it counts can void an update the live document holds. The device keeps
that update's operations, which every other device holds too, and stops
vouching for it: its founding view and edit attribution leave it out, and its
rotation proof, which rebuilds history without it, fails without a write, so
this device cannot unlink, move, or purge-unlink that document. It still
opens, edits, and syncs it, a pull that serves the update again voids it
without a read, and every other device rotates as before.

A rotation rebuilds the document's raw history, which holds that accepted
history and, past it, any update the device has not yet pulled; the rotation
installs those with the rest. A rotation page whose every update the live
document already covers reads accepted history, and a death there is far
likelier the rebuild's size or state than any update, so it counts toward the
device's rotation of the document, never toward an update, and isolates the
page's updates. A page reading an update the device has not accepted reads it
as a sync pass would, so a death there counts toward that update, and a
crashing update cannot stop a device's rotations by reaching it there first.
The acceptance check trusts the update's declared span, which any writer may
set to counters already committed, so an update the device never held can
pass as accepted. Each counted death is reported to the host's diagnostics
and Sentry. When the third under one judge, with no completed rebuild between
them, read one update alone, the device's next rebuild leaves that update out,
unread and unrecorded, and the exact-history check decides: a rebuild without
it that still equals the live document shows the device never held it, so
the rotation goes ahead and leaves it out from then on, while one that
differs shows the device holds it. Then, or when the third death read
several updates, the rebuild trying the update's absence died too, or three
more died while leaving it out, the device records the
document's rotation as unavailable and starts no more
(`DocumentRotationUnavailableError`): it cannot unlink, move, or purge-unlink
that document, and leaves those to other members, none of which waits on it.
A queued move it cannot prove parks as a denied one does, replaying once a
launch. It still opens, edits, and syncs the document. A completed rebuild
below the limit starts the count over, and so does a new judge (a decoder or
void rules change); an unavailable rotation, or an update left out, stays so
until then. A completed sync pull of
the document clears the suspects a rotation's death left, though it never
reads them. Until that pull, a rotation of the document reads its raw history
one update a page, since rotation pages save nothing that would clear the
suspects. A death outside a rotation page's window, between pages or in the
rebuild's final comparison, counts toward nothing.

## Peer Ownership

Earliest-wins voids the later of two updates that carry the same operation ids
(peer and counter) with different operations. A writer that committed
operations under another device's peer id at that device's next counters,
before the device's own update landed, would make every reader void the
device's update. The server now refuses that: past a peer's committed
frontier, only its [peer owner](./glossary/sync.md#peer-owner) may write
([what the server checks](#what-the-server-checks)).

A writer derives a separate peer id for each document or container it writes,
from a seed that never leaves its device, the signed-in user, and the record
(`recordPeerSeed`). Another member therefore cannot read a device's peer id on
a document from that device's updates to other documents: it first sees the
peer id in the device's first commit on the document, and by then the device's
user owns it. Two identities on one device also never write one history under
one peer id. The first update of a new container's metadata, organization
profile, or roster profile goes under a fresh peer id that is never reused.

### Rebasing onto a fresh peer

A device whose sync is refused with `document_sync_peer_owned` recovers by its
own steps. For each refused peer it keeps the operations below the frontier the
server named and cuts the rest, then cuts every operation that depends on a cut
one. It writes the cut operations' net effect again under a fresh peer, on a
fork of what it kept, and replaces the record's queued updates with one update
holding every fork operation from where its unsent operations start: on each
peer, the lowest of its pending base and every queued update's start on that
peer. That update re-asserts the refused peer's committed counters, which any
writer may do, and extends only the fresh peer, so the retry lands. Operations
committed on a refused peer stay under their ids in the fork whoever committed
them, so no reader sees them twice.

Before the server checks dependencies, a forged committed operation could
depend on a cut one. The rebase never cuts what the device knows is committed
(on a refused peer, below the named frontier; on any other peer, below where
its unsent operations start): writing it again under the fresh peer would
duplicate it for every reader, so the rebase fails loudly instead. Honest
histories never get there. A refusal that names no frontiers, such as an
unlink's, fails that operation; the document's next sync draws the refusal with
its frontiers and rebases, so a retry builds on the fork.

A document's fresh peer comes from a new random salt its record keeps
(`peer_salt`), so a reload writes on that peer and not the refused one. One
transaction replaces the record's history with the fork's full history, its
queue with the one update, and its void rows and preemption notices with none,
and moves the record to the next recovery generation, which fences out every
writer that read the old history. It writes nothing if the record or its
history moved past what the rebase read: another tab's queued edit is merged
into the fork before the cut, and one queued after that read makes the device
rebase again on its next refusal. Container metadata rebases the same way, with
its stored content as the fence, onto a random peer it keeps in memory only. A
reload derives the writer's own metadata peer again, which the server still
refuses, so the next write after a reload rebases again, once per written
container and session.

### Residuals

- **Recreation preemption.** A purge deletes a document's owner rows with its
  spans. A malicious member who republishes the purged document from history
  owns the peers of every record that survived it, and can commit their next
  counters before the devices' offline edits land. Those devices then rebase
  keeping their own operations below the forger's frontier as committed, and
  readers, who hold the forger's operations there first, void the update that
  re-asserts them.
- **Overclaims on one's own peer.** The server cannot read a payload, so an
  owner may declare a span past the operations it carries. The counters below
  that frontier are committed, so any writer may then fill them first, and
  readers void the owner's later operations there. Only a dishonest or broken
  client overclaims, and the cost falls on its own peer.
- **Same-user devices share ownership.** A peer belongs to a user, not a
  device. A modified client signed in as the same user can extend the peer of
  that user's other device, which honest devices never share, and readers void
  the later operations.
- **Operation references outside dependencies.** The rebase cuts by Loro
  dependencies. An operation that names another (a move or delete target)
  without depending on it is left to another track.

### Preemption notices

A device that is served a colliding update holds its own operations first, so
it voids the other writer's update instead. When that void reuses ids under
the peer id the device writes with, it records a notice in
`document_peer_preemptions` and reports once which writer (user and key
fingerprint) signed the update. For a rotation baseline that is the writer
that relayed the operations, not necessarily the one that forged them. A
forger that declares exactly the counters the device already holds is not
served to that device, because the device's frontier covers the declared
span, so the notice catches only a forgery the device is served. Under an
honest server a notice comes only from a non-owner re-asserting committed
counters with other operations, or from a residual above; under a dishonest
server it is the only signal. A rebase clears the document's notices and void
rows along with the history they were judged against.

## The Processed Cursor

Every page returns `pullPage.throughUpdateId`, the last update committed when
the pull began, and `pullPage.throughUpdateCount`, how many updates the
document held through it (0 exactly when the id is null). After the last page,
the reader stores both as its
[processed cursor](./glossary/sync.md#processed-cursor), with the frontier it
reached and its judge (the void-rules version and the Loro decoder version).
The count includes the updates the reader voided and those a rotation baseline
replaced, so a container listing's `metadataUpdateCount` at or below it owes no
read
([container metadata under lost hints](./client-sync-ordering.md#container-metadata-under-lost-hints)).
A create or registration that commits a container's metadata seed stores the
cursor that seed stands for (`recordCommittedSeedProgressInTransaction`): the
seed is its new document's one update, so the cursor names it with a count of
1, and a listing of a container this device created owes it no read.
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
  state is replaced.

The content key the reader holds is not among them. Every verdict behind a
cursor was reached under the key its update's envelope commits to, and every
reader holding that key reaches the same one. A cursor recorded before readers
checked the commitment carries an older judge, so it is withheld. Neither a
void row nor a cursor records a key, and a later pass holding another key for
an epoch leaves both as they are: it cannot judge the updates behind the
cursor differently, only fail on that epoch's later ones.
[`ContentKeyCommitment`](../formal/document-sync/ContentKeyCommitment.md)
checks this, since its key changes leave every reader's cursor where it is.

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
A founding view whose first update is void shows no founding update.
Container metadata documents void and keep a cursor the same way. A metadata
pass records its verdicts and cursor in the transaction that saves the
folder's metadata, and a save a concurrent one superseded records neither, so
the next pull judges that page again. A folder listing whose advertised
version an overclaim left uncovered still keeps that folder marked as behind.
[`VoidUpdateProgress`](../formal/document-sync/VoidUpdateProgress.md) checks
that no void update is applied, that readers agree, that a reader stays
current, and that a runtime failure voids an update the decoder can read only
after the bounded attempts.

## Attachment Binds and Detaches

An attachment bind or detach names the document version its client checked
the slot at, and the API refuses it while a committed update holds an op that
version lacks ([document version
precondition](./protocol-specification/blobs.md#document-version-precondition)).
An overclaim's ops are in no version, so on its own that check would refuse
every later bind and detach on the document. Each request therefore also
carries `processedThroughUpdateId`, and the API weighs only updates committed
after it. A detach also waits while the version its binding was bound at
names an op no committed update declares; an overclaim's declared span counts
as committed there, so a bind version naming its ops never holds the
binding. The SDK sends a cursor only with a version that covers the frontier
recorded with it, so the version holds every update the cursor's pull imported
and the pull voided the rest; a version read before that pull finished goes
without one. Any local record of the same server document may supply the
cursor, because what it judged is the server's history, not the record's.

While an update is unsettled after a runtime failure, the cursor stays before
it, so a bind or detach on that document is refused until the update imports
or is voided: at most `MAX_LORO_RUNTIME_ATTEMPTS` process lifetimes, never a
wait on another device.
[`AttachmentBindDocumentVersion`](../formal/blob-attachments/AttachmentBindDocumentVersion.md)
and
[`AttachmentRemovedSlotDetach`](../formal/blob-attachments/AttachmentRemovedSlotDetach.md)
model an overclaim and the cursor.

## Rotations and Unlinks

A rotation re-encrypts the document under a new content key from a
[rotation baseline](./glossary/keys.md#rotation-baseline), and the API
refuses one whose source version does not cover the committed frontier. An
overclaim's ops are in no version, so on its own that check would refuse
every rotation of the document, and with it every unlink.

Rotation's [raw-history recovery](./raw-document-history-recovery.md) judges
the whole history with the import judge a sync pass uses, keeping each void
this device recorded void without a Loro call and with no rebuild budget. It
rebuilds exactly what a sync pass applied: every ordinary update and every
served checkpoint the judge accepted, so the operations a writer's checkpoint
alone carries reach the new baseline, and no checkpoint queued or installed on
this device. It leaves out each void, which sync never applied either, and the
rebuilt history must still equal the live one. Only then does it record each
void its payload alone decides and report it the first time this device meets
it; an import void, which depends on the history it is judged against, is left
out unrecorded. An update held after a runtime failure fails the rotation,
which retries later. A death in the rebuild counts toward the device's
rotation of the document, not the update; three under one judge leave the
document's rotations to other members
([Loro runtime failures](#loro-runtime-failures)).

Each baseline then signs its author's processed cursor in its content-record
metadata as `coversThroughUpdateId`, but only when its snapshot holds the
frontier the cursor was recorded with, so the snapshot holds every update the
cursor's pull imported and the pull voided the rest. The sync and unlink gates
weigh only the updates committed after that cursor, and a first page goes
straight to a baseline when the baseline covers every later update it would
skip. A baseline without a cursor, or with one the document does not hold,
must cover every committed update. A container metadata baseline signs the
cursor its metadata pulls recorded, so an overclaim in a folder's metadata no
longer refuses the folder's rotations. The API stores the cursor beside the
baseline and authenticates it with the rest of the signed metadata, so a
stored cursor that is not the signed one fails the pull closed.

A document whose every update its author voided has an empty snapshot. Its
baseline declares no operation and signs the cursor alone, so the gates weigh
only the updates after it, and a new reader's first pull is redirected past
the voids (#3194). The empty baseline carries nothing, so no pull serves it,
though a pull's cursor still reaches it, and it never keeps a later baseline
from redirecting. The API admits an empty span only on a rotation baseline
that signs a cursor. A document never written has no cursor, so its unlink
carries no baseline and the API requires that no update is committed.

A rotation by a device whose older decoder voids an update a newer one reads
leaves that update out of the baseline for every reader. That is an accepted
residual of #3135: greenfield clients are expected to run the current Loro,
so the case is not designed for.
[`BaselineCursorCoverage`](../formal/document-sync/BaselineCursorCoverage.md)
models the cursor in the gates and the redirect, and
[`RawHistoryRecovery`](../formal/document-sync/RawHistoryRecovery.md) the
history recovery rebuilds and the voids it leaves out.

## Edit Attribution

The API credits each operation to the earliest update whose declared span covers
it (`GET /documents/{documentId}/attribution` and its `ranges`). A void update's
span is false, so an earlier void update could take the credit for operations a
later update really carried, and History would bound a change by the void
update's upload time and could report a clock running ahead.

Every reader of attribution in the SDK leaves out the ranges of updates the
device voided for good: rows in `document_void_updates` under its running judge,
in any local record of the document, except an update still unsettled after a
Loro runtime failure. Ranges drop those updates page by page. Compact segments
stay the API's list while the device holds no void update of the document;
otherwise the SDK builds them from the ranges without the void ones, merging
runs as the API does. Info's contributors and blame, row writers, Explorer's
edit ranges, and History's upload-time bound therefore agree, and the operations
a void update declared are credited to nobody.

The update that later carried those operations is not credited either, because
the API credits each operation once and does not know the reader's verdicts.
Readers whose judges differ can show different attribution. Both are accepted
residuals of #3194.
