# Document Rotation Baselines

A [rotation baseline](./glossary/keys.md#rotation-baseline) is a document's
whole history written again under a new content key, so that readers who
cannot open the old key still receive every operation. This document defines
its shape, the rules the API and a reader hold it to, the two ways a writer
sends one, and how it is stored and served. The rotations that need one are
in [document rekey and write history](./document-rekey-and-audit-history.md),
and the sync contract around it in
[document link and sync](./document-link-and-sync-protocol.md).

## A Baseline Is A Group Of Segments

A rotation baseline is an ordered group of ordinary update records, its
segments. Each segment is an `update`-mode Loro blob with its own update id,
envelope, and signed write header, written at the new content-key epoch.
Imported in index order into an empty document, the segments rebuild the
whole history their writer proved. A small history is one segment.

Each segment's signed content-record metadata places it in the group. The
metadata hash covers the baseline fields with the rest of the signed
metadata, so they reach the AES-GCM associated data and the
[write-header](./document-rekey-and-audit-history.md#signed-write-headers)
signature. The update row repeats them so the server can find a group's
segments. Readers recompute the metadata hash from the served fields, so a
field altered in storage fails verification.

What a group covers is not signed. It is derived from the segments' spans:
for each peer, where they end. A group's spans run gapless from zero, so
that version names every operation the group holds. The server does not turn
that coverage into a compare-and-set gate on accepted sync updates. A
retained client that loses a rotate race adopts the canonical bundle and
re-emits from local CRDT state if needed.

The final segment can also sign its author's processed cursor as
`coversThroughUpdateId`: every update committed at or before it was imported
into the history the baseline carries or void for its author. The rotation
gates and the redirect ask the group to cover only the updates committed
after that cursor, so an update whose op span overclaims does not refuse
every rotation
([advisory op spans](./advisory-op-spans.md#rotations-and-unlinks)). A
baseline whose author voided every update is one empty segment that signs
its cursor.

## Segment Fields

Five optional update fields place an update in a group:

| Field | Carried by | Meaning | Wire bound |
| --- | --- | --- | --- |
| `baselineId` | every segment | the group | UUID v4 |
| `baselineSegmentIndex` | every segment | the segment's place in the group | integer from 0 to 4,095 |
| `baselineSegmentCount` | the final segment | how many segments the group has | integer from 1 to 4,096 |
| `baselineSegmentsDigest` | the final segment | a digest of the segments before it | 64 lowercase hex characters |
| `coversThroughUpdateId` | the final segment, optional | the author's processed cursor | UUID |

Request and response validation hold each update to one field set.
`baselineId` and `baselineSegmentIndex` are absent together or both present.
`baselineSegmentCount` and `baselineSegmentsDigest` appear only together and
only with them. Only such a final segment may carry `coversThroughUpdateId`.
An ordinary update carries none of the five. The index and count bounds are
those of a [staged](#a-baseline-staged-ahead) baseline; one request carries
at most 64 segments.

A `baselineId` is its writer's choice, so it names a group only within its
document. Two documents may use the same one. Within a document it is taken
once a group commits under it.

The digest is a SHA-256 hash chain over canonical JSON under the domain
`tearleads.document.baseline-segments`
([`baselineSegmentsDigest.ts`](../packages/crypto/src/keying/core/baselineSegmentsDigest.ts)).
It starts from a hash of the document id and the baseline id. Each segment
before the final one, in index order, extends it with a hash of the digest so
far and that segment's index, update id, metadata hash, and ciphertext hash.
The final segment signs the chain's last value and is not an input, because
its own signed metadata carries the digest. A one-segment group signs the
start value. Because the digest is a chain, the writer, the API, and a reader
that meets segments one at a time each keep one hash, never the list.

## Group Rules

The API holds every baseline to these rules before it commits any of it:

1. Every segment names the same `baselineId`.
2. The segments are in index order from zero, with none missing.
3. Only the final segment carries the count, the digest, and the cursor, and
   its count is the number of segments.
4. A segment's start and end vectors name only peers it carries operations
   of, each starting exactly where the earlier segments left that peer, from
   zero.
5. A segment depends only on operations the earlier segments carry, and each
   entry of its dependency vector names one: a counter from 1 to what they
   reached on that peer. An entry at zero names no operation and is refused,
   so a writer cannot pad a dependency vector with peers nothing carries.
6. A segment with no operations (no span) is allowed only as the whole of an
   empty baseline: one segment with `baselineSegmentCount` 1 that signs a
   cursor. Its author voided every update through that cursor.
7. The final segment's digest is the digest of the earlier segments' update
   ids, metadata hashes, and ciphertext hashes.

Rules 4 and 5 are one walk, the import of the segments into an empty
document (`baselineSegmentContinues`). A dependency vector may still name
every peer the group carries. An honest history of concurrent merges does
that too, so no rule can tell the two apart, and the request's bytes bound
it.

The API then weighs coverage. What a group covers is derived, not signed: for
each peer, the counter the walk reached, never a vector a segment declares.
That version must hold the frontier of the updates committed after the
group's signed cursor; with no cursor, or one that names no update of the
document, every committed update. The group is committed ahead of every
other update of its request, so the gate has weighed every update committed
ahead of it, whatever a cursor comes to name later.

The peer-ownership rule judges each segment's spans like any update's: a span
ending at or below a peer's committed frontier re-asserts it, which any
writer may do, and one past it extends a peer that must be the writer's or
unowned ([advisory op spans](./advisory-op-spans.md#what-the-server-checks)).

A baseline commits whole or not at all. Its segments, their spans, and their
write headers are written in the transaction of the request that rotates, in
index order, so every refusal leaves no row. A sync that advances the
content-key epoch must carry a newly written baseline. An identical retry of
a committed one inserts nothing and is accepted when it advances nothing.

## A Baseline Sent Whole

A writer whose history fits one request sends the group inline, where the
API judges it in one pass (`judgeDocumentBaselineGroup`):

- An unlink's `rotationBaseline` is an array of 1 to 64 segments in index
  order.
- A sync sends a group's segments first in `outgoingUpdates`, contiguous and
  in index order. Ordinary updates may follow the group, never precede it or
  sit between its segments, and a request carries at most one group.

`MAX_DOCUMENT_BASELINE_SEGMENTS` is 64, the most updates one sync carries.

| Refused group | Response |
| --- | --- |
| It breaks a group rule; it holds an update that is no segment; a sync puts other updates ahead of its segments or between them; or only some of a sync group's update ids are already committed. | `409 document_sync_baseline_group_invalid`, on both routes |
| A sync's group does not cover the committed frontier after its cursor. | `409 document_sync_checkpoint_coverage_conflict` |
| An unlink's group does not cover it. | `409 document_unlink_rotation_baseline_stale` |
| A segment's declared fields are not the ones its write header signs. | `400`, the metadata hash mismatch of any update |
| A new group reuses a `baselineId` its document committed. | `409`, an uncoded write conflict |
| An unlink's group holds a segment whose update id is already committed. | `409`: an update id conflict, or an uncoded refusal when the committed row is identical |

The SDK sends a baseline this way when the group fits: at most 64 segments
whose payloads total no more than the sync request ceiling, 16 MiB, on
either route. A small document's rotation is one request, as it was before
staging existed. Any other history goes through a stage, by the
[rotation baseline writer](./rotation-baseline-writer.md), which also
answers each refusal below.
The SDK builds a group for the request that sends it and queues nothing
locally as a baseline: every queued row is an ordinary update.

## A Baseline Staged Ahead

A writer whose history does not fit one request stages it. It uploads every
segment but the final one ahead of time, one request each, and the unlink or
sync that rotates carries the final segment and names the stage
(`baselineStageId`). Nothing staged is an update of the document: no pull
serves it, no frontier counts it, and no reader learns of it until that
request commits.

| Route | Does |
| --- | --- |
| `POST /documents/{documentId}/baseline-stages` | Opens the stage. The body names the `baselineId` and the content key the segments are encrypted under, by `contentKeyEpoch` and `contentKeyCommitment`. |
| `PUT /documents/{documentId}/baseline-stages/{baselineId}/segments/{segmentIndex}` | Stages one segment: the same body as one of a sync's `outgoingUpdates`. |
| `PUT .../segments/{segmentIndex}/write-header` | Replaces a staged segment's signed write header, without its ciphertext. |
| `GET /documents/{documentId}/baseline-stages/{baselineId}` | Returns the stage: its next index, its digest so far, its staged bytes, and its expiry. |
| `DELETE /documents/{documentId}/baseline-stages/{baselineId}` | Abandons the stage and what it staged. |

**Canonical ids.** A stage path names its document and baseline by their
canonical ids, lower-case as every signed artifact spells them; any other
spelling is refused with `400`. The digest a final segment signs starts
from the document id, and a reader starts its own from the id it holds, so
a stage rooted in another spelling would commit a group no reader can
reproduce. The API also roots the stage row, its digest, and each staged
header's check in the id the document's row stores, never the request's.
A sync that commits a stage under another spelling of the document id is
refused as any write under it is.

**Access on every request.** Staging is a document write. Opening a stage,
staging a segment, and re-signing a header each require, when the request
arrives, that the caller can write the document and that its organization
is entitled to sync with a seat for the caller, as the commit does
(`requireStageWriter`). A writer whose access was revoked or whose
organization lapsed gets the `403` or `402` any document write gets; its
stage takes nothing more and ends at the expiry it had. Reading a stage
needs the same access and an open sync endpoint, as a read-only sync does;
abandoning one needs neither.

**Opening.** The epoch is the document's current one, with that epoch's
stored commitment, or a later one that the committing request opens. A user
holds at most one open stage per document: opening another deletes the
earlier one and what it staged, and repeating an open returns the stage as
it stands. A user holds at most four open stages across documents
(`MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER`); a fifth is refused with
`document_baseline_stage_limit_reached` until one commits, is abandoned, or
expires. A `baselineId` the document committed, or that another user's
stage on the document holds, is refused.
An open takes the document's lifecycle lock, which a purge holds from
before it deletes the document's stages until it commits, so a stage is
never stored for a document a purge has removed.

**Staging.** Segments are staged strictly in order: a segment's index is the
stage's next. The API verifies each one as it verifies any update: the write
header's signature under the session's key, the document and organization it
names, its epoch, the signed metadata and ciphertext hashes, the envelope,
and the envelope's commitment to the stage's content key. It then walks the
segment against the stage by group rules 4 and 5, reading the stage's
frontier for just the peers the segment names. The final segment is never
staged, so a staged segment carries no count, digest, or cursor. Sending a
staged index again with the same update id and ciphertext hash is
acknowledged without a write.

A content record and its nonce domain belong to one update of a document's
epoch. A segment whose header signs one that a staged segment of its stage
or a committed update holds is refused with
`document_baseline_stage_segment_conflict`, as one under a committed update
id is: its stage could never commit.

What staging cannot check is whether the header's manifest, key-target set,
and cited container manifests authorize its writer: the manifest a rotation
writes does not exist until the request that commits. So a stage stores, for
each header, a hash of every field an authorization check reads
(`writeHeaderAuthorizationHash`), and the commit settles it.

**Re-signing.** A writer whose plan moved while it uploaded, to another
manifest head, key-target set, or signing key, signs its staged headers
again and sends only those. A new header must sign the same content record,
metadata hash, ciphertext hash, and nonce domain, so neither the stored
ciphertext nor the stage's digest changes.

**Bounds.** A staged baseline holds at most 4,096 segments, the final one
included (`MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS`). A staged segment's
request is held to the sync request ceiling
(`MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES`), so every committed segment
fits a response page as an update a sync committed does. One stage stores
at most 1 GiB (`MAX_DOCUMENT_BASELINE_STAGE_BYTES`), counting everything a
staged row keeps of a segment: its ciphertext, its three signed vectors,
its plaintext hash, and its write header (the status's `stagedBytes`). It
stores at most 1,048,576 span rows (`MAX_DOCUMENT_BASELINE_STAGE_SPANS`),
one for each peer a segment carries. A segment that would pass either bound
is refused with `document_baseline_stage_too_large`, the stage unchanged.

A stage expires an hour after its last staged segment or re-signed header
(`DOCUMENT_BASELINE_STAGE_IDLE_SECONDS`) and never later than 24 hours after
it opened (`DOCUMENT_BASELINE_STAGE_MAX_SECONDS`). The hourly maintenance run
deletes expired stages and what they staged
(`cleanupExpiredDocumentBaselineStages`), and a document purge deletes the
document's. A run reads expired stages in batches of 100, oldest expiry
first, and deletes each in its own transaction until none is left. It stops
early only at 10,000 stages (`MAX_EXPIRED_STAGES_PER_SWEEP`) or five minutes
(`EXPIRED_STAGE_SWEEP_BUDGET_MS`); it then reports the expired stages it
left and logs a warning, and the next run continues. An expired stage holds
its bytes until a run reaches it and is dead meanwhile: nothing stages to
it, re-signs in it, or commits it. No storage quota counts staged bytes:
the data-usage report sums committed updates and blobs. These bounds are
the whole limit on what a member holds uncommitted;
[limits](./limits.md#document-sync) gives the arithmetic.

### Stage refusals

A stage route answers with a `document_baseline_stage_*` code that tells the
writer what its stage is worth:

| Code | Status | Meaning | The writer |
| --- | --- | --- | --- |
| `document_baseline_stage_not_found` | 404 | No stage of this caller under that id on that document. Only this coded 404 proves it. | opens a new stage |
| `document_baseline_stage_expired` | 409 | The stage passed its expiry. | opens a new stage |
| `document_baseline_stage_epoch_stale` | 409 | The document moved past the stage's content-key epoch, or the stage names another key for it. | abandons it and plans again |
| `document_baseline_stage_id_conflict` | 409 | The `baselineId` is a committed baseline's or another user's stage. | chooses another id |
| `document_baseline_stage_limit_reached` | 409 | Only at an open: the caller holds four open stages on other documents. | abandons one, or waits |
| `document_baseline_stage_too_large` | 409 | The segment would take the stage past its byte or span bound. The stage is unchanged. | cannot stage this history whole |
| `document_baseline_stage_segment_out_of_order` | 409 | The index is not the stage's next; the body names `nextSegmentIndex`. | resumes from that index |
| `document_baseline_stage_segment_conflict` | 409 | The index, the update id, or the content record is taken by other bytes. At a commit: a staged segment's content record was committed since. | signs the segment again under its own ids, or abandons the stage |
| `document_baseline_stage_segment_invalid` | 409 | The segment breaks a group rule at that place, or is a final segment. No honest writer sends one. | builds the baseline anew |
| `document_baseline_stage_headers_stale` | 409 | Only at a commit: the staged headers do not name what the final segment's header names. | re-signs the staged headers |

A failed access or billing check, a malformed header, and a bad signature
fail as on any document write (`403`, `402`, `400`), without a stage code,
and leave the stage and its expiry as they were. A stage route sends no
other 404: an open on a document that is gone is an uncoded `409`.

### Committing a stage

The request that rotates carries exactly one baseline segment, the final
one: alone in an unlink's `rotationBaseline`, first in a sync's
`outgoingUpdates`. Under the locks that request already holds, the document
manifest-head lock among them, the API:

1. locks the stage row (`lockStagedBaselineForCommit`), and requires the
   caller's own, unexpired stage, for the epoch the request writes at, whose
   next index is the final segment's;
2. holds the final segment to the group rules with the stage standing for
   the earlier segments: its count is its index plus one, it continues the
   staged history, and its digest is the stage's chain;
3. proves coverage (`assertStagedBaselineCoversCommittedFrontier`): where the
   staged spans and the final segment's spans end must hold the committed
   frontier after the cursor, read for just the peers that frontier names;
4. verifies the final segment in full, as any update of the request;
5. requires the stage's content key to be the epoch's, and every staged
   header's authorization hash to equal the final header's, in one statement
   over the stage (`promoteStagedBaselineSegments`), and that no staged
   segment's content record or nonce domain is a committed header's, the
   final segment's among them;
6. applies the peer-ownership rule to the stage's spans as sets, and claims
   the unowned peers the stage extends;
7. inserts one update row per staged segment in segment order, then their
   write headers and spans, and deletes the stage row;
8. walks and inserts the request's own updates, the final segment first.

Step 7 copies no ciphertext. The update rows it inserts hold no payload, and
readers take each one's from the staged row by update id. The final
segment, which travelled in the request, is stored inline like any update.

What a commit writes under the head lock scales with the stage's segments
and spans, not its bytes: one update row and one write-header row per
staged segment, one span row per staged span, and at most one peer-owner
row per span. The bounds cap that at 4,095 update rows, 4,095 header rows,
1,048,576 span rows, and as many owner rows. A history of many peers meets
the span bound long before the byte bound: a 250 KiB segment can declare
50,000 peers, and committing 100,000 staged spans took about one second on
the in-memory test database. A baseline sent whole writes span rows under
the same lock, bounded by its 16 MiB request rather than by a count.
A staged update id that another document's update took since it was staged
refuses the commit with `document_sync_update_id_conflict`: the head lock
keeps out only this document's writers.

A refusal for the stage is `409 document_sync_baseline_group_invalid` on
either route, with the stage's own code beside it as `baselineStageCode`; the
route's `code` values do not change. A group that is sound and stops short
of the committed frontier draws the route's coverage refusal, and the writer
stages a tail segment for what was committed since and commits again. Every
refusal writes nothing and leaves the stage as it was. A retry of a sync
that committed finds its final segment committed and no stage, and inserts
nothing. The realtime hint a commit publishes names the request's own
updates, the final segment among them, and not the staged segments: a hint
only prompts a pull, and the pull pages the whole group.

The sweep and a commit both take the stage's row lock first, so of the two
exactly one proceeds: a commit that wins deletes the row and the sweep finds
nothing, and a sweep that wins leaves the commit no stage. Every delete of
staged segments (sweep, abandon, replacement) skips a row that is a
committed segment's payload, so a committed segment keeps its payload
whatever stage later names the same id.
[StagedBaselineCommit](../formal/document-sync/StagedBaselineCommit.md)
models the stage, the commit, the sweep, and a reader paging through both.

## Serving And The Redirect

Segments are stored and paged as ordinary updates, in commit order, so a
group's segments arrive as one run over as many pages as they take. Each
served segment carries its baseline fields and its ciphertext, wherever that
is stored. A stored row whose columns no longer give its signed metadata
hash fails the pull with `409 document_sync_conflict`, and so does a
committed segment whose payload row is gone.

The redirect picks the latest whole group at the current content-key epoch
with one statement that reads no payload and no vector
(`findLatestWholeStoredBaselineGroup`). A group is sealed by its final
segment. It is whole when its rows within the pull's bound are as many as
that segment's count, their indexes run from zero in commit order, and no
other update of the document was committed among them. A group that lost a
row, or that the pull's upper bound cuts, is passed over for an older one,
at most four times (`MAX_LATEST_BASELINE_GROUP_CANDIDATES`); past that the
pull serves every missing update, which loses nothing.

What the group covers is read from its stored spans by a second statement
(`readStoredBaselineGroupCoverage`), which walks them in segment order as
the commit did and gives no coverage when they no longer run gapless from
zero. It runs only for a reader that starts before the group and lacks
something ahead of it. Neither statement grows with the group's payload,
and the first does not grow with its segment count beyond an index range.
When the redirect applies, the first page starts just before the group's
first segment.

**The redirect trusts structure, and serving checks the rows.** The
redirect chooses a group by its stored indexes, count, and spans. It does
not authenticate the group's rows again, which would mean reading every
payload and header of a group of any size before the first page. This is
an accepted trade-off, and it fails closed. Each row is checked as it is
served: its signed metadata hash is recomputed from the stored columns, and
a committed segment must still have its payload. A group that is whole by
structure and holds an altered row is still chosen, and the pull is refused
with `409 document_sync_conflict` at that row: the reader is served no part
of the group, nor the older epoch's history in its place. Only a database
altered outside the API holds such a group, and no retry mends it. A
reader's own checks do not rest on any of this: it authenticates every
segment it is served ([reader checks](#reader-checks)).

## Reader Checks

A reader authenticates, decrypts, judges, and imports a segment exactly as it
does any update. Every served payload must be an `update`-mode Loro blob, and
a snapshot payload is a [void update](./glossary/content.md#void-update). A
page's accepted updates, segments included, go to the live document in one
import.

The reader also holds the groups a server serves to their rules
(`judgeServedBaselineGroups`), by what the page was requested with:

- **Cold page.** A page requested with no version is served every update in
  its range: a pull's first page that names no processed cursor, and every
  page of a raw-history pull. A group on it starts at index 0 and is
  followed whole: each next served update is the group's next index, and
  the final segment's count is its index plus one and its digest the digest
  of the served segments. A start past index 0, another update in between,
  a skipped or repeated index, and a pull that ends before the final
  segment each break the group.
- **A whole group across pages.** The pull continuation carries the baseline
  id, the next index, and the digest so far
  (`readPullContinuation(response, baselineGroupRun)`). The page that
  continues it is requested with no version, whatever the reader holds by
  then, because the server leaves out every update whose operations a page's
  version holds, and a reader served the ordinary history ahead of the group
  already holds the later segments' operations.
- **Any other page.** Indices only rise within a group, across pages too, a
  final count is its index plus one, and a lone segment signs the start.

On every page the reader must hold what a segment signs that it builds on.
The API keeps a group's dependencies inside it and omits a segment only when
the reader holds it, so a segment whose signed start or dependencies name an
operation the reader lacks was served without the segments it builds on, and
breaks the group. Two cases are its writer's doing and void instead: a
payload that leaves a gap inside its own range, and a segment lacking only
operations that unapplied segments of its group, served earlier in the pull,
declare. The run carries those spans, one a peer; a host must pass it on.

A broken group fails the pass at stage `baseline_group`. It is never a void:
the reader imports nothing from the page and records no void, which would
outlast the server's correction. The page is refused on each pass until the
server serves the group whole, and the device's queued writes do not settle
meanwhile ([a liveness trade](./limits.md#limits-that-trade-write-liveness)).

## Storage

A baseline's segments are ordinary `document_updates` rows, with their
`document_update_spans` rows and write headers. A group sent whole is one
insert in index order, and a staged group's rows are inserted in segment
order ahead of the final segment's, so `sequence` rises with the index
either way. Nullable columns hold each segment's signed
[baseline fields](#segment-fields), and an ordinary update leaves all five
null:

- `baseline_id` and `baseline_segment_index`, on every segment
- `baseline_segment_count` and `baseline_segments_digest`, on the final
  segment only
- `baseline_covers_through_update_id`, on a final segment that signs a cursor

No column stores what a group covers: the redirect reads the segments'
spans. A partial index on `(document_id, sequence)` where `baseline_id` is
set lists a document's segments for the redirect. A unique partial index on
`(document_id, baseline_id, baseline_segment_index)` keeps two rows from
taking one place in a group, so a new group that reuses a `baselineId` its
document committed is refused as a write conflict.

`encrypted_data` is null on exactly the segments a stage committed, and a
check constraint keeps a null payload to baseline segments. Three tables
hold stages
([`documentBaselineStages.ts`](../packages/api-shared/src/schema/documentBaselineStages.ts)):

| Table | Holds | Lives |
| --- | --- | --- |
| `document_baseline_stages` | One row per open stage, keyed `(document_id, id)`: its owner, organization, content-key epoch and commitment, next index, digest so far, staged bytes and spans, and expiry. Unique on `(document_id, owner_user_id)`, and indexed by owner for the per-user bound. | From the open until a commit, an abandon, a replacement, or the sweep. |
| `document_baseline_segments` | One row per staged segment, keyed by update id: the ciphertext, the signed vectors and plaintext hash, the verified write header, the header's authorization hash, and its content record and nonce domain, each unique within the stage. | A row a commit left as its update's payload, the update of the same document and baseline under its id that holds none of its own, is deleted only with its document. Every other row goes with its stage. |
| `document_baseline_segment_spans` | The staged segments' spans, from which a stage's frontier is read. | A commit moves them to `document_update_spans`; otherwise they go with their stage. |

The committed header and vectors are copied to the update row and
`document_content_write_headers`; the staged row keeps its own, which
nothing reads again.

Three readers consume the baseline columns:

- the coverage-gated baseline redirect
  ([`documentSyncBaselineRedirect.ts`](../packages/api/src/documents/documentSyncBaselineRedirect.ts)),
  which picks the latest whole group at the current content-key epoch
  ([`documentStoredBaselineGroup.ts`](../packages/api/src/documents/documentStoredBaselineGroup.ts))
- the sync response
  ([`syncResponseUpdates.ts`](../packages/api/src/workflows/documents/mutations/syncResponseUpdates.ts)),
  which returns each served segment's baseline fields and reads its payload
  through the update row
  ([`documentUpdatePageRows.ts`](../packages/api/src/documents/documentUpdatePageRows.ts))
- edit attribution
  ([`documentEditAttribution.ts`](../packages/api/src/documents/documentEditAttribution.ts)),
  which flags spans a baseline segment first delivered as re-assertions
  rather than authorship

The sync response recomputes the signed metadata hash from these columns and
the update row, so a tampered column fails closed: a pull that would serve
the row fails. The write contract marks segments explicitly on outgoing
updates with the [baseline segment fields](#segment-fields). Only marked
updates set the columns.
