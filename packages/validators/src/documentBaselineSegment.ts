export const DOCUMENT_BASELINE_SEGMENT_FIELD_SET_ISSUE_MESSAGE =
  "baseline fields must be absent, mark a baseline segment, or mark a baseline's final segment";

/**
 * The fields that place an update in a rotation baseline: an ordered group of
 * updates that together carry a document's whole history at the epoch a
 * rotation opened.
 */
interface DocumentBaselineSegmentFields {
  readonly baselineId?: string | undefined;
  readonly baselineSegmentIndex?: number | undefined;
  readonly baselineSegmentCount?: number | undefined;
  readonly baselineSegmentsDigest?: string | undefined;
  readonly coversThroughUpdateId?: string | undefined;
}

export type DocumentBaselineSegmentFieldClassification =
  | "absent"
  | "final-segment"
  | "invalid"
  | "segment";

/**
 * Which kind of update the baseline fields make. Every segment names its
 * baseline and its index. Only the final segment carries the count and the
 * digest, always together, and only it may carry the author's processed
 * cursor. Whether the count fits the index, and every rule that spans a
 * group, is the API's and the reader's to check.
 */
export function classifyDocumentBaselineSegmentFields({
  baselineId,
  baselineSegmentCount,
  baselineSegmentIndex,
  baselineSegmentsDigest,
  coversThroughUpdateId,
}: DocumentBaselineSegmentFields): DocumentBaselineSegmentFieldClassification {
  const sealsGroup =
    baselineSegmentCount !== undefined || baselineSegmentsDigest !== undefined;
  if (baselineId === undefined && baselineSegmentIndex === undefined) {
    return sealsGroup || coversThroughUpdateId !== undefined
      ? "invalid"
      : "absent";
  }
  if (baselineId === undefined || baselineSegmentIndex === undefined) {
    return "invalid";
  }
  if (!sealsGroup) {
    return coversThroughUpdateId === undefined ? "segment" : "invalid";
  }
  return baselineSegmentCount !== undefined &&
    baselineSegmentsDigest !== undefined
    ? "final-segment"
    : "invalid";
}
