import type { z } from "zod";
import {
  loosePlainObject,
  plainObjectSchema,
  positiveIntegerSchema,
  sha256HexStringSchema,
  uuidV4StringSchema,
} from "../schema";

/**
 * Opens the stage of one rotation baseline. The id is the `baselineId` every
 * segment signs. The epoch and commitment name the content key the segments
 * are encrypted under: the document's current one, or the one the rotating
 * request will open.
 */
export const DocumentBaselineStageOpenRequestSchema = loosePlainObject({
  baselineId: uuidV4StringSchema,
  contentKeyCommitment: sha256HexStringSchema,
  contentKeyEpoch: positiveIntegerSchema,
});

export type DocumentBaselineStageOpenRequest = z.infer<
  typeof DocumentBaselineStageOpenRequestSchema
>;

export function isDocumentBaselineStageOpenRequest(
  value: unknown,
): value is DocumentBaselineStageOpenRequest {
  return DocumentBaselineStageOpenRequestSchema.safeParse(value).success;
}

/** A staged segment's write header, signed again over the same ciphertext. */
export const DocumentBaselineStageWriteHeaderRequestSchema = loosePlainObject({
  writeHeader: plainObjectSchema,
});

export type DocumentBaselineStageWriteHeaderRequest = z.infer<
  typeof DocumentBaselineStageWriteHeaderRequestSchema
>;

export function isDocumentBaselineStageWriteHeaderRequest(
  value: unknown,
): value is DocumentBaselineStageWriteHeaderRequest {
  return DocumentBaselineStageWriteHeaderRequestSchema.safeParse(value).success;
}
