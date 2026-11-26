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
| `id_conflict` at the open | chooses another id |
| `segment_out_of_order` | reads the stage and goes on from the index it expects |
| `segment_conflict`, `segment_invalid`, a group refusal with no stage code | deletes the stage and builds the baseline anew |
| Any other failure of a stage request (access, billing, an outage, a lost answer) | stops, and leaves the stage as it is. Nothing is retried blindly. A sync records the failure with the refusal's own status as it records a refused submit; an unlink reports it to its caller. |

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
every segment again; a stage nobody replaces expires. Durable resume across
a restart is not built.

## What A Caller Sees

A sync reports progress as trace lines
(`document sync baseline stage document=… status=… segments=…`), one a
state and one every sixteen staged segments, and an unlink through the
host's log. Three failures are terminal for a history:

- One operation larger than a segment may be:
  `DocumentSyncRequestLimitError`. A sync's heal ends in the coded failure
  `document_sync_request_too_large`.
- A history that needs more than 4,096 segments:
  `DocumentRotationBaselineSegmentLimitError`, a request-limit error, so a
  heal ends in the same code and an unlink throws it. The stage is deleted.
- A final segment that does not fit the rotating request beside what else
  it carries: the same request-limit failure. The writer cuts the final
  segment small, so this needs one operation of megabytes at the end of the
  history, or a request already near its ceiling.
