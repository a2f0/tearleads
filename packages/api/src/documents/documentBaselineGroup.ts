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

/** The vectors one segment signs. */
export interface BaselineSegmentVectors {
  readonly dependencyVersionVector: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
}

/** One peer's operations a segment carries: `[startCounter, endCounter)`. */
export interface BaselineSegmentSpan {
  readonly endCounter: number;
  readonly peerId: string;
  readonly startCounter: number;
}

/** What a segment's vectors name: its spans, and the ops it depends on. */
export interface BaselineSegmentHistory {
  /** Each peer depended on, with one past the latest such operation. */
  readonly dependencies: readonly (readonly [
    peerId: string,
    counter: number,
  ])[];
  readonly spans: readonly BaselineSegmentSpan[];
}

/** How many peers a segment's start and end vectors name between them. */
function namedPeerCount(segment: BaselineSegmentVectors): number {
  return new Set([
    ...decodeVersionVector(segment.partialStartVersionVector).toJSON().keys(),
    ...decodeVersionVector(segment.partialEndVersionVector).toJSON().keys(),
  ]).size;
}

/**
 * Read a segment's spans and dependencies from its vectors. A segment's
 * vectors are otherwise only claims: one that names a peer at a counter the
 * group has not reached would stand for operations no segment holds. So a
 * segment's start and end name only the peers it carries operations of, as
 * the vectors of an exported update do; entries without a span would also
 * let a writer make every reader's first page weigh thousands of peers no
 * segment carries. Returns null when a vector does not decode or names a
 * peer the segment has no span for.
 */
export function readBaselineSegmentHistory(
  segment: BaselineSegmentVectors,
): BaselineSegmentHistory | null {
  try {
    const spans = listVersionVectorSpans(segment);
    if (namedPeerCount(segment) !== spans.length) return null;
    return {
      dependencies: [
        ...decodeVersionVector(segment.dependencyVersionVector).toJSON(),
      ],
      spans,
    };
  } catch {
    return null;
  }
}

/**
 * Whether a segment continues the history before it, as an import into a
 * document holding exactly that history would: it starts every peer it
 * carries where the earlier segments left it (`held`), from zero, and each
 * dependency names an operation they carry.
 *
 * A dependency is one past the latest operation depended on, so an honest
 * one is at least 1 and at most what the earlier segments reached on that
 * peer. An entry at zero names no operation. It would pass a bound check
 * against any peer, known or not, so a writer could pad every dependency
 * vector with peers nothing carries, for the API and every reader to decode;
 * it is refused. What remains is naming peers the group does carry, which an
 * honest history of concurrent merges does too, and which the request's
 * bytes bound.
 */
export function baselineSegmentContinues(
  held: (peerId: string) => number,
  history: BaselineSegmentHistory,
): boolean {
  return (
    history.spans.every((span) => held(span.peerId) === span.startCounter) &&
    history.dependencies.every(
      ([peerId, counter]) => counter >= 1 && counter <= held(peerId),
    )
  );
}

interface GroupHistory {
  /** Whether some segment carries no operations. */
  readonly hasEmptySegment: boolean;
  /** Per peer, the counter the segments' spans reach from zero. */
  readonly reached: ReadonlyMap<string, number>;
}

/**
 * Walk the segments as an import into an empty document would
 * (`baselineSegmentContinues`). What the walk reaches is what the group
 * carries. Returns null when a segment breaks the walk or a vector does not
 * decode.
 */
function walkGroupHistory(
  segments: readonly DocumentBaselineSegment[],
): GroupHistory | null {
  const reached = new Map<string, number>();
  const held = (peerId: string) => reached.get(peerId) ?? 0;
  let hasEmptySegment = false;
  for (const segment of segments) {
    const history = readBaselineSegmentHistory(segment);
    if (!history || !baselineSegmentContinues(held, history)) return null;
    for (const span of history.spans) reached.set(span.peerId, span.endCounter);
    hasEmptySegment ||= history.spans.length === 0;
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
 *   it, from zero, and depends only on operations they carry, each
 *   dependency naming one;
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
