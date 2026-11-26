import { describeSchema } from "../jsonSchemaAnnotations";
import {
  DocumentBaselineStageOpenRequestSchema,
  DocumentBaselineStageWriteHeaderRequestSchema,
} from "../request";
import {
  DocumentBaselineStageAbandonResponseSchema,
  DocumentBaselineStageConflictErrorResponseSchema,
  DocumentBaselineStageErrorCodeSchema,
  DocumentBaselineStageNotFoundErrorResponseSchema,
  DocumentBaselineStageStatusResponseSchema,
} from "../response";

describeSchema(
  DocumentBaselineStageOpenRequestSchema,
  "Opens the stage of one rotation baseline: the segments a writer uploads ahead of the request that rotates.",
  {
    baselineId:
      "The id every segment of the baseline signs as `baselineId`. Client-chosen; it names the stage in later requests.",
    contentKeyCommitment:
      "Commitment of the content key the segments are encrypted under. For the document's current epoch it must be the stored one; for the next epoch it must be the one the rotating request's bundle declares.",
    contentKeyEpoch:
      "Content-key epoch the segments are written at: the document's current epoch, or the one the rotating request opens.",
  },
);

describeSchema(
  DocumentBaselineStageWriteHeaderRequestSchema,
  "A staged segment's write header signed again, for the same ciphertext.",
  {
    writeHeader:
      "The new signed write header. It must name the staged segment's content record, metadata hash, ciphertext hash and nonce domain at the stage's epoch.",
  },
);

describeSchema(
  DocumentBaselineStageStatusResponseSchema,
  "A rotation baseline stage as the server holds it.",
  {
    baselineId: "The staged baseline's id.",
    contentKeyCommitment: "Commitment of the content key the stage is for.",
    contentKeyEpoch: "Content-key epoch the stage is for.",
    expiresAt:
      "When the stage expires unless another segment or header arrives first, as an ISO 8601 instant.",
    nextSegmentIndex:
      "Index the next staged segment must carry, and the index of the final segment a rotating request sends to commit the stage now.",
    segmentsDigest:
      "The baseline digest over the segments staged so far: what a final segment sent now must sign as `baselineSegmentsDigest`.",
    stagedBytes:
      "Bytes the stage stores so far: each staged segment's ciphertext, signed vectors, plaintext hash and write header. A stage holds at most 1 GiB.",
  },
);

describeSchema(
  DocumentBaselineStageAbandonResponseSchema,
  "Acknowledges that a stage and its staged segments were deleted.",
  { baselineId: "The abandoned baseline's id." },
);

describeSchema(
  DocumentBaselineStageErrorCodeSchema,
  "Why a staged rotation baseline was refused: the stage is gone (`not_found`, `expired`), can no longer commit (`epoch_stale`, `id_conflict`), needs its headers signed again (`headers_stale`), was sent a segment out of order, in conflict with what it holds or with a committed update, or that no baseline holds at that place, would grow past what a stage may store (`too_large`), or would be one more than a user may hold open (`limit_reached`).",
);

describeSchema(
  DocumentBaselineStageNotFoundErrorResponseSchema,
  "The stage does not exist for this caller and document; only this coded 404 proves it is gone.",
);

describeSchema(
  DocumentBaselineStageConflictErrorResponseSchema,
  "A refused stage request. A `document_baseline_stage_*` code says what the stage is worth now; an uncoded conflict is a failed access check or a write that raced another, and leaves the stage as it was.",
  {
    nextSegmentIndex:
      "With `document_baseline_stage_segment_out_of_order`, the index the stage expects next.",
  },
);
