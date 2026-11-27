# Rotation Baseline Writer

How the client SDK writes a
[rotation baseline](./glossary/keys.md#rotation-baseline): when it sends the
group whole, when it uploads it through a
[baseline stage](./glossary/keys.md#baseline-stage), and what it does when
the API refuses either. The shape of a baseline, the stage routes, and the
rules the API holds both to are in
[document rotation baselines](./document-rotation-baselines.md).

The SDK writes a baseline for two requests: a sync that heals a stale
[content-key bundle](./glossary/keys.md#content-key-bundle), and an unlink.
A move, a trash, and a purge-unlink are compositions over the unlink. Both
go through one writer
([`baselineStage/`](../packages/client-sdk/src/workflows/documents/baselineStage/),
`writeRotationBaseline`).

## Cutting

The writer opens the proven full-history snapshot and cuts it
into segments of about 4 MiB of plaintext and never more than 11 MiB
(`DEFAULT_HISTORY_SEGMENT_MAX_BYTES`, the default of
[`@tearleads/loro`](../packages/loro/README.md)). Its caller may pass
smaller sizes (`rotationBaselineSegmentSizes`); larger ones are held to
the cap.

A segment is one update, and the API takes no update that serializes to
more than 16 MiB: as a staged segment's request, as a segment an unlink
carries inline, or in a sync's request. 11 MiB of plaintext is 14.67 MiB
once it is base64 inside its envelope, which leaves about 1.3 MiB for the
segment's version vectors and its header: a segment 64 KiB under the cap
measured 14.59 MiB signed, 7.6 KiB of it header and vectors. The room is
not a proof, since a document of very many peers has vectors of any size.
So the signer weighs each segment once it is signed
(`rotationBaselineSigner`) and refuses one over 16 MiB with
`DocumentRotationBaselineLimitError` before anything is sent, and a staged
upload that meets one deletes its stage. A heal's group sent whole is
signed with its request, which is held to the same 16 MiB as a whole.

The history is exported one segment ahead of the one being encrypted, so
the writer knows which segment is the final one; each segment is exported,
encrypted, signed, and handed on before the next is cut. Beside the
snapshot it holds the segments it is still deciding whether to send whole
(at most one request's worth) and two more, never the baseline.

## Whole Or Staged

Segments are kept while the group can still travel
whole. Once it cannot, the writer opens a stage, uploads what it kept, and
uploads the rest as it cuts it. A heal's request is also held to its exact
byte ceiling after it is signed; a group that fits before that and not
after is written again through a stage. The final segment of a staged
baseline travels in the rotating request beside everything else it
carries, so the writer cuts the end of the history small: a last segment
over 1 MiB is cut again at that size
(`ROTATION_BASELINE_FINAL_SEGMENT_TARGET_BYTES`).

## One Plan

A staged upload fixes what every attempt to commit it must
sign alike (`StagedBaselinePlan`): the fresh content key and its epoch,
and, for an unlink, the signed link-set event. A signature differs each
time it is made and the manifest an unlink writes hashes its event, so an
attempt that signed the same event again would name another manifest, and
every staged header would be stale. An attempt whose event is otherwise the
same keeps the signature.

## Where A Key Has Gone

A rotation commits a fresh key so that someone cannot read what is written
after it: the members a container's key rotation dropped, for a heal, and
the container an unlink removes. An upload holds its key between attempts,
so a later attempt could commit a key that an earlier request already
carried to the party the rotation is meant to keep out:

- A heal wraps its key for every linked container. Its sync is refused for
  coverage, or gets no answer, and its upload stays. An unlink of one of
  those containers then finds the upload at the epoch it opens.
- An unlink of container X is refused, and its upload stays with a key
  wrapped for every container but X. An unlink of container Y then finds
  it.

In both the held key is known to the removed container's members, and to
whoever kept the earlier request, whether the API took that request,
refused it, or never answered. The reverse direction matters too: if an
unlink's commit got no answer and a later heal ran against a stale
projection that still linked the removed container, reusing the unlink's
key would wrap a post-revocation key for that container. So an upload
records every target its key was wrapped for
(`StagedBaselineUpload.wrapKeyFor`), and an attempt takes the held plan
only if its own target set matches those targets exactly
(`reusableStagedBaselinePlan`):

- A **target** is one key epoch of one linked container: a content-key
  bundle envelope's `containerId` and `containerKeyEpochId`. A container's
  next key epoch is another target, since the members its rotation dropped
  hold the earlier one. Nothing else in a rotating request gives the key to
  anyone: the envelopes are the only place it is wrapped, an unlink's event
  carries no key, its attachment rewraps wrap each attachment's own key and
  not the document's, and the staged segments are ciphertext.
- The record only grows, and it is not part of the upload's attempt-tagged
  state: a request a superseded run sent gave the key away as surely as the
  current run's. An attempt's targets are recorded when it takes the plan,
  before any request is built, so a request that is never sent counts too.
- The rule is exact target-set equality. A retry of the same heal or the
  same unlink has the same targets and goes on with the upload; any change
  in the target set — shrinking, expanding, or advancing a container key
  epoch — disqualifies the held key.
- An attempt that does not qualify plans afresh: a new key, and for an
  unlink a new event id and signed time. The writer finds the document's
  upload planned for another key, gives it up, and deletes its stage, whose
  segments the exposed key encrypts, before it opens its own
  (`writeOnce`). That is what an unlink does with a heal's upload: the heal
  finds its upload gone on its next pass and plans again at the epoch after
  the unlink's.
- The writer holds the request's own envelopes to the same rule where they
  are in hand. A key about to be wrapped for a different target set than it
  went to is never sent: the upload is given up and the attempt fails.

A process that restarts has no upload and no held key, so it plans afresh.

## The Upload Machine

The upload is a state machine
([`stagedBaselineState.ts`](../packages/client-sdk/src/workflows/documents/baselineStage/stagedBaselineState.ts),
[`stagedBaselineMachine.ts`](../packages/client-sdk/src/workflows/documents/baselineStage/stagedBaselineMachine.ts)).
Every run starts a new attempt, and only an event tagged with the current
attempt moves it, so a request an earlier run left in flight cannot finish
for a later one.

Its state holds what the writer remembers of the stage: a record of each
staged segment (`records`) and what the staged headers were signed for
(`headersSignedFor`). Both change only through the transition, so the
attempt tag guards them too: a superseded run's late read of the stage
cannot shorten the records the live run commits by. A record is kept
before its segment is sent (`segmentSent`), because the answer may be
lost. A run that finds a later one has started ends without a word
(`superseded`): its answer is nobody's failure, and the upload it would
give up is the later run's.

Runs do overlap. A sync pass holds the document's remote-work lock, and an
unlink holds it only while it proves its history, so an unlink's upload can
start while a heal's request is on the wire, and the reverse. A pass that
is cancelled, or that loses its lane, leaves its request to be answered:
`stillCurrent` discards the answer and aborts nothing.

| State | The writer |
| --- | --- |
| `planning` | has no stage; the run chooses a baseline id |
| `opening` | opens the stage for the key the rotating request will write under |
| `staging` | exports, encrypts, signs, and uploads segment `nextSegmentIndex` |
| `committing` | has handed the final segment to the rotating request |
| `appendingTail` | was refused for coverage; the stage stands for a longer history |
| `resuming` | reads where the stage stands before it relies on it |
| `confirming` | checks that the history it was given still gives every staged segment |
| `resigningHeaders` | signs each staged header again, one request a segment |
| `done`, `abandoned`, `failed` | is finished |

## Recovery By Refusal

Each refusal is an event of the machine:

| Refusal | The writer |
| --- | --- |
| The route's coverage refusal (`document_sync_checkpoint_coverage_conflict`, `document_unlink_rotation_baseline_stale`) | keeps the stage. The attempt that brings a longer proven history reads the stage, confirms it, stages a tail of what the history holds past the staged segments, and commits again. |
| `headers_stale` | signs every staged header again and commits again: within the unlink leg, and by planning again within the sync pass. Either goes back through the writer, which reads the stage and confirms what is staged before it signs: one read more than the headers need. The writer also knows what its headers were signed for, and signs them again before it commits when its plan names another manifest, key-target set, or signing key. |
| `not_found`, `expired` | plans again: a new baseline id, a new stage, every segment uploaded again. While uploading, once within the same run. |
| `epoch_stale` | deletes the stage. The plan it was built for is stale, so the next attempt plans against a fresh projection. |
| `id_conflict` | at the open, chooses another id. At a commit, a request committed a baseline under the stage's id since it opened: the writer deletes the stage, which can never commit, and builds the baseline anew under another id. A sync does so within the pass, and an unlink on its next attempt. |
| `segment_out_of_order` | reads the stage and goes on from the index it expects. A run reads its stage three times at most (`MAX_STAGE_READS_PER_RUN`); a stage that still is not where its own answers put it is deleted and the run fails (`stage_unsettled`). |
| `segment_conflict`, `segment_invalid`, a group refusal with no stage code | deletes the stage and builds the baseline anew |
| `limit_reached` at the open | abandons the longest idle [orphaned stage](#orphaned-stages) the refusal names and opens once more. If none is an orphan, or the open is refused again, it fails with `DocumentRotationBaselineStageLimitError` and does not retry: the user holds four open stages already. A sync records a failure row with that code, and an unlink reports it. |
| `too_large` | deletes the stage and fails with `DocumentRotationBaselineLimitError`: the history needs more bytes or span rows than a stage stores. A header signed again counts by its difference from the one it replaces, so signing again can draw this too. |
| A stage request, or the rotating request, refused for the writer itself: access or billing (`403`, `402`), a request the API will not take (`400`, a `413` for a re-signed header over 512 KiB), or the document's own refusal, an uncoded `409`, which a stage route sends when the document is gone or takes no write as it stands | gives the upload up and deletes the stage, so it does not hold one of the user's four open stages until it expires. Nothing is retried. A sync records the failure with the refusal's own status as it records a refused submit; an unlink reports it to its caller with that status. |
| A stage request that got no answer, a `5xx`, a throttle (`429`), or a timeout (`408`) | stops, and leaves the stage as it is: the failure says nothing about it. The next run reads the stage and goes on. A sync records the failure with its status, as it records any sync request that failed, and the row clears when a later pass commits; an unlink reports it to its caller. |
| A final segment whose request cannot be made: it is over 16 MiB once an unlink signs it, or a heal's request cannot carry it | gives the upload up and deletes the stage. A commit that was sent and got no answer keeps the stage: the next run reads it. |
| `document_sync_update_id_conflict` on a sync that commits a stage | keeps the stage: the refusal names an update id, not the stage. The pass settles its queued writes with a read-only pull as for any sync, and the next pass reads the stage and commits it with a final segment under a new id. |

## Header Bounds

The API bounds every write header where it parses one: a device id of at
most 128 characters, a signature in canonical base64, and at most 6,400
cited container manifests, with a re-signed header's request at most
512 KiB. The writer signs each header, staged, signed again, or final,
with `signWriteHeader`, which refuses the first and the third before it
signs and encodes the signature canonically. The device id is
`signing-key:` and the signing key's fingerprint, 76 characters. A request
cites at most the 6,400 manifests its 64 authorization paths of depth 100
name, and a header that cites them all is about 430 KiB.

## Confirming A Stage

Before a run relies on a stage it reads it
(`GET`), keeps only the records the stage acknowledges, and requires the
stage's digest to be the one its own records chain to. It then exports each
staged segment's range from the history it was given and compares the keyed
plaintext hash with the one the staged segment signs
(`stagedSegmentMatchesHistory`). A history that left a range out, or that
encodes it otherwise, ends the stage, and the run builds the baseline anew.
The writer keeps no ciphertext for this: a record is a segment's ids,
vectors, and hashes.

## A Tail

The segments after a stage carry what the history holds past
the staged ones (`exportHistorySegments` with a start version), in Lamport
order among themselves. Operations concurrent with the staged segments
sort among them in the grown history, but a segment only has to start each
peer where the earlier ones left it and depend on what they carry, and a
tail does.

## Interruption And Restart

An upload lives in memory, one a document
per database (`getOrCreateStagedBaselineUploads`), so a sync's heal and an
unlink of one document share it, and the next attempt after a refusal or a
lost answer finds it. A process that restarts has no upload. Its next
attempt opens a new stage, which replaces the one left behind, and uploads
every segment again. A stage nobody replaces holds one of the user's four
open stages until it expires or a later upload finds it
[orphaned](#orphaned-stages). Durable resume across a restart is not built.

## Orphaned Stages

A user holds at most four open stages across documents, and the refusal of
a fifth (`limit_reached`) names the four as `openStages`, each with its
document, its id, and its expiry. The writer then abandons the orphan
among them that has been idle longest and sends the open once more
(`openPastOrphanedStages`). One place is all the open needs, and an abandon
is not undone, so the other orphans are left to expire or to the next
upload that is refused. A stage is an orphan when both hold:

- no upload of this database is filling it
  (`StagedBaselineUploads.tracks`); and
- it has gone untouched for ten minutes or more
  (`ORPHANED_STAGE_IDLE_MS`).

A stage expires an hour after its last staged segment or re-signed header,
so the writer takes the expiry less that hour as the time of the last
write. A live upload writes to its stage with every segment, so a stage
idle for ten minutes is one a restarted process left, or an upload that
stalled.

The idle rule is what keeps two devices of one user apart. Each sees the
other's stages in the list and tracks none of them, and leaves any that was
written to in the last ten minutes. A stage of this database's own upload
is never an orphan however long it stands: a tail waits for a longer
history, and a lost answer for the next pass.

Three cases read a live stage as an orphan. Each costs its upload a stage,
never a write: the writer that finds its stage gone (`not_found`) opens
another and sends its segments again.

- Another device's upload that stalled for ten minutes, by a slow link or a
  pass that ended, and has not gone on.
- A stage in the last fifty minutes of the 24 hours a stage may stand. Its
  expiry is then the end of those hours and not an hour after its last
  write, so it reads as idle since the hour before its end.
- A device whose clock runs ten minutes or more ahead of the API's. The
  expiry is the API's time and is read against the device's clock.

An abandon that fails frees no place, and the next longest idle orphan is
tried; an abandon that finds the stage gone has freed its place. If no
place was freed the open is not sent again, and it is sent again at most
once: a limit that still stands is reported as
`DocumentRotationBaselineStageLimitError`.

## What A Caller Sees

A sync reports progress as trace lines
(`document sync baseline stage document=… status=… segments=…`), one a
state and one every sixteen staged segments, and an unlink through the
host's log. Four failures are terminal for a history, and a fifth,
`DocumentRotationBaselineStageLimitError`, for the moment: the user has
four other uploads open and none of them is an
[orphan](#orphaned-stages).

- One operation larger than a segment may be:
  `DocumentSyncRequestLimitError`. A sync's heal ends in the coded failure
  `document_sync_request_too_large`.
- A history larger than a stage stores (1 GiB, or 1,048,576 span rows), or
  one that needs more than 4,096 segments:
  `DocumentRotationBaselineLimitError`, a request-limit error, so a heal
  ends in the same code and an unlink throws it. The stage is deleted. At
  the default sizes the byte bound comes first, at about 750 MiB of
  history.
- One segment that is over 16 MiB once signed, with its vectors and
  header: the same error, before the segment is sent. It takes a segment
  near the cap in a document of tens of thousands of peers.
- A final segment that does not fit the rotating request beside what else
  it carries: the same request-limit failure. The writer cuts the final
  segment small, so this needs one operation of megabytes at the end of the
  history, or a request already near its ceiling.
