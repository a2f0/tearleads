# Rotation Baselines Past a False Op Span

[`BaselineCursorCoverage.tla`](./BaselineCursorCoverage.tla) models how the
server weighs a [rotation baseline](../../docs/glossary/keys.md#rotation-baseline)
against a log that can hold an update whose
[op span](../../docs/advisory-op-spans.md) overclaims (#3135). The server
cannot read a baseline, so it compares the baseline's signed source version
with the spans committed updates declare. An overclaim declares an operation
no update carries, so no source covers it, and before the baseline signed a
cursor one overclaim refused every rotation, and so every unlink, of its
document.

A baseline now signs its author's processed cursor, the last update of a pull
the author completed, having imported or voided every update up to it. The
author signs it only when the snapshot holds the frontier the cursor was
recorded with. The gate that admits a baseline, through sync or an unlink,
and the redirect that starts a new reader at one both weigh only the updates
committed after that cursor.

An author that voided every update it judged holds an empty document. Its
baseline is the empty snapshot, which declares no operation and signs the
cursor alone, so the gate weighs only later updates (#3194). Before, the
author sent no baseline, and the unlink was refused while any update was
committed. The server still refuses an empty baseline without a cursor,
which no honest client sends. The model's cursor is a committed update; the
server weighs a cursor that names none as signing none, so it admits an empty
baseline with such a cursor only when no update is committed, where it
carries nothing and no pull serves it.

## Production Mapping

| Model action or predicate | Production implementation |
| --- | --- |
| `Write` | a writer's update committed with its signed span by `appendDocumentUpdates` |
| `Judged` | `validateDocumentSyncUpdateImports`, which voids an update whose span is false |
| `Rotate` signing rule | `readProcessedCursorForVersion`, called by `buildDocumentRotationBaseline` and `resolveBaselineCursors` |
| `Gate` / `CoversAfter` | `committedFrontierAfterBaselineCursor` in `assertSyncRotationBaselinesSound` and `assertAtomicRotationBaselineCoversCommittedFrontier` |
| `Gate`'s empty-snapshot rule | `assertOutgoingSpanOrCursoredEmptyBaseline`, which admits an empty span only for a rotation baseline that signs a cursor |
| `Rotate`'s empty-snapshot rule | `buildDocumentRotationBaseline`, which builds an empty baseline only when `readProcessedCursorForVersion` yields a cursor |
| `RedirectJumps` | `resolveBaselineRedirectAfterSequence`, over `listMissingDocumentUpdateCandidates`, which never counts an empty baseline as missing |
| the signed cursor in `Baselines` | `coversThroughUpdateId`, signed in `documentContentRecordMetadata` and stored as `baselineCoversThroughUpdateId` |

## Checked Properties and Bounds

The registered configuration allows three writes, each truthful or an
overclaim, and three rotation attempts. A rotation's author has judged a
prefix of the log for its cursor and built its snapshot from a prefix no
longer than that, as a device whose snapshot predates its latest pull does.
An empty snapshot is sent only with a cursor; the unlink that carries no
baseline is [EmptyFrontierUnlink](./EmptyFrontierUnlink.md). The run explores
531 distinct states.

- `RotationKeepsTruthfulOps`: no accepted baseline lacks a truthful operation
  committed before it.
- `HonestRotationAccepted`: an author that judged the whole log is never
  refused, however many overclaims the log holds, even when every update is
  one and its snapshot is empty. Only its own device acts, so no device waits
  on another.
- `RedirectSkipsNoTruthfulOp`: a redirect never skips a truthful operation the
  baseline lacks.
- `AcceptedBaselineRedirects`: a new reader starts at the latest accepted
  baseline.

Every reader voids an overclaim and imports a truthful update here;
[VoidUpdateProgress](./VoidUpdateProgress.md) covers decoders, dependencies,
and runtime failures. A writer that signs a cursor past its snapshot is
dishonest and outside the model, as are forged dependencies and peer-id
reuse.

## Negative Controls

| Switch | Expected violation |
| --- | --- |
| `WeighAfterCursor = FALSE` | `HonestRotationAccepted`: the gate weighs every committed update, and one overclaim refuses each rotation |
| `SignCoveredCursorOnly = FALSE` | `RotationKeepsTruthfulOps`: a baseline signs a cursor its snapshot predates and is accepted without what the author imported later |
| `RedirectAfterCursor = FALSE` | `AcceptedBaselineRedirects`: the redirect weighs every skipped update and never jumps past an overclaim |
| `AcceptCursoredEmptyBaseline = FALSE` | `HonestRotationAccepted`: the server refuses every empty baseline, so an author that voided every update cannot rotate |
