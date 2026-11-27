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
(`ROTATION_BASELINE_SEGMENT_MAX_BYTES`), unless its caller passes other
sizes (`rotationBaselineSegmentSizes`). The cap leaves a segment room in a
16 MiB stage request once it is base64 inside its envelope. The history is
exported one segment ahead of the one being encrypted, so the writer knows
which segment is the final one; each segment is exported, encrypted, signed,
and handed on before the next is cut. Beside the snapshot it holds the
segments it is still deciding whether to send whole (at most one request's
worth) and two more, never the baseline.

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

## The Upload Machine

The upload is a state machine
([`stagedBaselineMachine.ts`](../packages/client-sdk/src/workflows/documents/baselineStage/stagedBaselineMachine.ts)).
Every run starts a new attempt, and only an event tagged with the current
attempt moves it, so a request an earlier run left in flight cannot finish
for a later one.

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
| `headers_stale` | signs every staged header again and commits again: within the unlink leg, and by planning again within the sync pass. The writer also knows what its headers were signed for, and signs them again before it commits when its plan names another manifest, key-target set, or signing key. |
| `not_found`, `expired` | plans again: a new baseline id, a new stage, every segment uploaded again. While uploading, once within the same run. |
| `epoch_stale` | deletes the stage. The plan it was built for is stale, so the next attempt plans against a fresh projection. |
| `id_conflict` | at the open, chooses another id. At a commit, a request committed a baseline under the stage's id since it opened: the writer deletes the stage, which can never commit, and builds the baseline anew under another id. A sync does so within the pass, and an unlink on its next attempt. |
| `segment_out_of_order` | reads the stage and goes on from the index it expects |
| `segment_conflict`, `segment_invalid`, a group refusal with no stage code | deletes the stage and builds the baseline anew |
| `limit_reached` at the open | abandons the [orphaned stages](#orphaned-stages) the refusal names and opens once more. If none is an orphan, or the open is refused again, it fails with `DocumentRotationBaselineStageLimitError` and does not retry: the user holds four open stages already. A sync records a failure row with that code, and an unlink reports it. |
| `too_large` | deletes the stage and fails with `DocumentRotationBaselineLimitError`: the history needs more bytes or span rows than a stage stores. A header signed again counts by its difference from the one it replaces, so signing again can draw this too. |
| A stage request, or the rotating request, refused for the writer itself (`402`, `403`, a `413` for a re-signed header over 512 KiB, or any other refusal with no stage code) | gives the upload up and deletes the stage, so it does not hold one of the user's four open stages until it expires. Nothing is retried. A sync records the failure with the refusal's own status as it records a refused submit; an unlink reports it to its caller with that status. |
| A stage request that got no answer, or a `5xx` | stops, and leaves the stage as it is: the failure says nothing about it. The next run reads the stage and goes on. |

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
document, its id, and its expiry. The writer then abandons every listed
stage that is an orphan and sends the open once more
(`openPastOrphanedStages`). A stage is an orphan when both hold:

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

An abandon that fails frees no place, and an abandon that finds the stage
gone has. If no place was freed the open is not sent again, and it is sent
again at most once: a limit that still stands is reported as
`DocumentRotationBaselineStageLimitError`.

## What A Caller Sees

A sync reports progress as trace lines
(`document sync baseline stage document=… status=… segments=…`), one a
state and one every sixteen staged segments, and an unlink through the
host's log. Three failures are terminal for a history, and a fourth,
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
- A final segment that does not fit the rotating request beside what else
  it carries: the same request-limit failure. The writer cuts the final
  segment small, so this needs one operation of megabytes at the end of the
  history, or a request already near its ceiling.
