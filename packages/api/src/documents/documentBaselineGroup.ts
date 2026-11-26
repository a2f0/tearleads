import { computeDocumentBaselineSegmentsDigest } from "@tearleads/crypto";
import {
  historySegmentsImportInOrder,
  mergeVersionVectors,
  versionVectorsEqual,
} from "@tearleads/loro";

/**
 * One segment of a rotation baseline, as a request declares it or a stored
 * row holds it. Its hashes are the ones its signed write header carries.
 */
export interface DocumentBaselineSegment {
  readonly baselineId: string | null | undefined;
  readonly baselineSegmentCount: number | null | undefined;
  readonly baselineSegmentIndex: number | null | undefined;
  readonly baselineSegmentsDigest: string | null | undefined;
  readonly ciphertextHash: string;
  readonly coversThroughUpdateId: string | null | undefined;
  readonly dependencyVersionVector: string;
  readonly metadataHash: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly updateId: string;
}

/** A whole baseline: what it covers and the cursor its author signed. */
export interface DocumentBaselineGroup {
  readonly baselineId: string;
  /**
   * The version the segments reach together: for each peer, the end of its
   * last span. A group's spans run gapless from zero, so the group holds
   * every operation this version names.
   */
  readonly coverage: string;
  readonly coversThroughUpdateId: string | undefined;
}

/** Which group rule a list of segments breaks. */
export type DocumentBaselineGroupFault =
  | "cursor_missing"
  | "digest_mismatch"
  | "empty_segment"
  | "history_not_gapless"
  | "mixed_baseline"
  | "segment_count_mismatch"
  | "segment_out_of_order"
  | "sealed_early";

export type DocumentBaselineGroupVerdict =
  | { readonly group: DocumentBaselineGroup; readonly ok: true }
  | { readonly fault: DocumentBaselineGroupFault; readonly ok: false };

const FAULT_MESSAGES: Record<DocumentBaselineGroupFault, string> = {
  cursor_missing:
    "a baseline with no operations is one segment that signs a processed cursor",
  digest_mismatch:
    "the final segment's digest does not match the segments before it",
  empty_segment: "a segment of a baseline of several carries no operations",
  history_not_gapless:
    "the segments do not carry each peer's operations gapless from zero, each depending only on earlier segments",
  mixed_baseline: "the segments name more than one baseline",
  segment_count_mismatch:
    "the final segment's count is not the number of segments",
  segment_out_of_order: "the segments are not in index order from zero",
  sealed_early:
    "only the final segment carries the count, the digest and the cursor",
};

export function documentBaselineGroupFaultMessage(
  fault: DocumentBaselineGroupFault,
): string {
  return FAULT_MESSAGES[fault];
}

function seals(segment: DocumentBaselineSegment): boolean {
  return (
    segment.baselineSegmentCount != null ||
    segment.baselineSegmentsDigest != null ||
    segment.coversThroughUpdateId != null
  );
}

/** The identity and order rules, which read each segment's own fields. */
function placementFault(
  segments: readonly DocumentBaselineSegment[],
  baselineId: string,
): DocumentBaselineGroupFault | null {
  const final = segments.length - 1;
  for (const [position, segment] of segments.entries()) {
    if (segment.baselineId !== baselineId) return "mixed_baseline";
    if (segment.baselineSegmentIndex !== position) {
      return "segment_out_of_order";
    }
    if (position < final && seals(segment)) return "sealed_early";
  }
  return segments[final]?.baselineSegmentCount === segments.length
    ? null
    : "segment_count_mismatch";
}

/**
 * Whether the segments rebuild a history from nothing when imported in
 * order. A segment with no operations is allowed only as the whole of an
 * empty baseline, whose author voided every update through the cursor it
 * signs. A vector that does not decode fails the same rule.
 */
function historyFault(
  segments: readonly DocumentBaselineSegment[],
  final: DocumentBaselineSegment,
): DocumentBaselineGroupFault | null {
  let empty: boolean;
  try {
    if (!historySegmentsImportInOrder(segments)) return "history_not_gapless";
    empty = segments.some((segment) =>
      versionVectorsEqual(
        segment.partialStartVersionVector,
        segment.partialEndVersionVector,
      ),
    );
  } catch {
    return "history_not_gapless";
  }
  if (!empty) return null;
  if (segments.length > 1) return "empty_segment";
  return final.coversThroughUpdateId == null ? "cursor_missing" : null;
}

/**
 * Judge an ordered list of segments as one rotation baseline:
 *
 * - every segment names the same baseline, and the list is in index order
 *   from zero with none missing;
 * - only the final segment carries the count, the digest and the cursor, and
 *   its count is the number of segments;
 * - each peer's spans run gapless from zero across the list, and each
 *   segment depends only on operations earlier segments carry;
 * - the final segment's digest is the digest of the segments before it.
 *
 * It reads declared fields and signed hashes only. The caller has verified,
 * or goes on to verify, each segment's signature and that its fields are the
 * ones its metadata hash signs.
 */
export async function judgeDocumentBaselineGroup(input: {
  readonly documentId: string;
  readonly segments: readonly DocumentBaselineSegment[];
}): Promise<DocumentBaselineGroupVerdict> {
  const { segments } = input;
  const final = segments.at(-1);
  const baselineId = segments[0]?.baselineId;
  if (!final || baselineId == null) {
    return { fault: "mixed_baseline", ok: false };
  }
  const fault =
    placementFault(segments, baselineId) ?? historyFault(segments, final);
  if (fault) return { fault, ok: false };
  const digest = await computeDocumentBaselineSegmentsDigest({
    baselineId,
    documentId: input.documentId,
    segments: segments.slice(0, -1),
  });
  if (digest !== final.baselineSegmentsDigest) {
    return { fault: "digest_mismatch", ok: false };
  }
  return {
    group: {
      baselineId,
      coverage: mergeVersionVectors(
        segments.map((segment) => segment.partialEndVersionVector),
      ),
      coversThroughUpdateId: final.coversThroughUpdateId ?? undefined,
    },
    ok: true,
  };
}
