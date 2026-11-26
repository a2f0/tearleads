import { computeDocumentBaselineSegmentsDigest } from "@tearleads/crypto";
import {
  decodeVersionVector,
  encodeVersionVectorCounters,
  listVersionVectorSpans,
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
   * The version the segments carry together: for each peer, where its spans
   * end. It is read from the walk that proves the spans run gapless from
   * zero, never from a vector a segment declares, so the group holds every
   * operation this version names.
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
  | "not_a_segment"
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
  not_a_segment: "it holds an update that is not a baseline segment",
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
    if (segment.baselineId == null) return "not_a_segment";
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

interface GroupHistory {
  /** Whether some segment carries no operations. */
  readonly hasEmptySegment: boolean;
  /** Per peer, the counter the segments' spans reach from zero. */
  readonly reached: ReadonlyMap<string, number>;
}

/**
 * Walk the segments as an import into an empty document would: each must
 * start every peer it names exactly where the earlier segments left it, from
 * zero, and depend only on operations they carry. What the walk reaches is
 * what the group carries. A segment's vectors are otherwise only claims: one
 * that names a peer at a counter the group has not reached, with or without
 * a span of its own, would stand for operations no segment holds. Returns
 * null when a segment breaks the walk or a vector does not decode.
 */
function walkGroupHistory(
  segments: readonly DocumentBaselineSegment[],
): GroupHistory | null {
  const reached = new Map<string, number>();
  const held = (peerId: string) => reached.get(peerId) ?? 0;
  let hasEmptySegment = false;
  try {
    for (const segment of segments) {
      const spans = listVersionVectorSpans(segment);
      const starts = decodeVersionVector(segment.partialStartVersionVector);
      const dependencies = decodeVersionVector(segment.dependencyVersionVector);
      if (
        [...starts.toJSON()].some(
          ([peerId, counter]) => held(peerId) !== counter,
        ) ||
        spans.some((span) => held(span.peerId) !== span.startCounter) ||
        [...dependencies.toJSON()].some(
          ([peerId, counter]) => held(peerId) < counter,
        )
      ) {
        return null;
      }
      for (const span of spans) reached.set(span.peerId, span.endCounter);
      hasEmptySegment ||= spans.length === 0;
    }
  } catch {
    return null;
  }
  return { hasEmptySegment, reached };
}

/**
 * A segment with no operations, one whose vectors give no span, is allowed
 * only as the whole of an empty baseline, whose author voided every update
 * through the cursor it signs.
 */
function emptySegmentFault(
  segments: readonly DocumentBaselineSegment[],
  final: DocumentBaselineSegment,
  history: GroupHistory,
): DocumentBaselineGroupFault | null {
  if (!history.hasEmptySegment) return null;
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
 * - each segment starts every peer it names where the earlier segments left
 *   it, from zero, and depends only on operations they carry;
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
    return { fault: "not_a_segment", ok: false };
  }
  const placement = placementFault(segments, baselineId);
  if (placement) return { fault: placement, ok: false };
  const history = walkGroupHistory(segments);
  if (!history) return { fault: "history_not_gapless", ok: false };
  const fault = emptySegmentFault(segments, final, history);
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
      coverage: encodeVersionVectorCounters(
        Object.fromEntries(history.reached),
      ),
      coversThroughUpdateId: final.coversThroughUpdateId ?? undefined,
    },
    ok: true,
  };
}
