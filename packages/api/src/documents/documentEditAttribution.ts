/**
 * Edit-attribution resolver: maps Loro op ranges to the roster member who is
 * authoritatively responsible for them.
 *
 * Each document update covers per-peer op spans (document_update_spans) and is
 * signed by a writer (writerUserId/writerKeyFingerprint in its write header).
 * The same (peer,counter) can be covered by MORE than one update — a writer's
 * delta exports from their full version vector, so a signed batch can re-assert
 * ops other peers authored, and a rotate_baseline re-asserts every peer from
 * counter 0. Attributing from the latest/widest covering span would let a
 * re-asserter (or a baseline author) be credited with another member's edits —
 * verifiable-but-WRONG, the worst audit failure.
 *
 * So attribution resolves each op to the EARLIEST covering span by server
 * receive order (document_updates.sequence): the first signed batch that
 * delivered the op. That writer is the authoritative first uploader. We also
 * surface authorityKind: "baseline" when the earliest covering update is a
 * rotate_baseline (a re-assertion / snapshot, never proof of authorship) vs
 * "direct" for an ordinary incremental update (normally the author's own edit).
 * Callers should treat "direct" as "first signed uploader", not as a
 * cryptographic proof that this exact member typed these characters.
 */

export type EditAttributionAuthorityKind = "direct" | "baseline";

export interface AttributionSpanInput {
  readonly peerId: string;
  readonly startCounter: number;
  readonly endCounter: number;
  /** The signed update (document_updates.id) that delivered this span. */
  readonly updateId: string;
  /** Server receive order of the covering update (document_updates.sequence). */
  readonly sequence: number;
  readonly writerUserId: string;
  readonly writerKeyFingerprint: string;
  /** The covering update is a rotate_baseline checkpoint. */
  readonly isBaseline: boolean;
}

export interface DocumentEditAttributionSegment {
  readonly peerId: string;
  readonly startCounter: number;
  readonly endCounter: number;
  /** The signed update (document_updates.id) that first delivered this range. */
  readonly updateId: string;
  /** Server receive order of that update (document_updates.sequence). */
  readonly updateSequence: number;
  readonly writerUserId: string;
  readonly writerKeyFingerprint: string;
  readonly authorityKind: EditAttributionAuthorityKind;
}

interface ClaimedInterval {
  start: number;
  end: number;
  readonly span: AttributionSpanInput;
}

function authorityKindFor(
  span: AttributionSpanInput,
): EditAttributionAuthorityKind {
  return span.isBaseline ? "baseline" : "direct";
}

function groupSpansByPeer(
  spans: readonly AttributionSpanInput[],
): Map<string, AttributionSpanInput[]> {
  const spansByPeer = new Map<string, AttributionSpanInput[]>();
  for (const span of spans) {
    if (span.endCounter <= span.startCounter) {
      continue;
    }
    const peerSpans = spansByPeer.get(span.peerId) ?? [];
    peerSpans.push(span);
    spansByPeer.set(span.peerId, peerSpans);
  }
  return spansByPeer;
}

// Claim the counters in `span` that no EARLIER-sequence span has claimed yet;
// those remainders are the ones `span` first delivered to the server.
function claimSpanRemainder(
  span: AttributionSpanInput,
  claimed: ClaimedInterval[],
): void {
  const overlapping = claimed
    .filter(
      (interval) =>
        interval.start < span.endCounter && interval.end > span.startCounter,
    )
    .sort((left, right) => left.start - right.start);

  let cursor = span.startCounter;
  for (const interval of overlapping) {
    if (interval.start > cursor) {
      claimed.push({ start: cursor, end: interval.start, span });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < span.endCounter) {
    claimed.push({ start: cursor, end: span.endCounter, span });
  }
}

function claimedIntervalsForPeer(
  peerSpans: readonly AttributionSpanInput[],
): ClaimedInterval[] {
  const claimed: ClaimedInterval[] = [];
  for (const span of [...peerSpans].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    claimSpanRemainder(span, claimed);
  }
  return claimed.sort((left, right) => left.start - right.start);
}

// One segment per claimed interval — never coalesced. Adjacent same-peer
// intervals only ever come from DIFFERENT updates: document_update_spans is
// unique on (updateId, peerId) (document_update_spans_update_peer_idx), so a
// single update contributes at most one span per peer, and a span's claimed
// remainders against earlier spans are pairwise non-contiguous. Merging adjacent
// intervals would therefore always merge across uploads — exactly the per-upload
// provenance this drill-down exists to keep.
function appendInterval(
  segments: DocumentEditAttributionSegment[],
  peerId: string,
  interval: ClaimedInterval,
): void {
  segments.push({
    peerId,
    startCounter: interval.start,
    endCounter: interval.end,
    updateId: interval.span.updateId,
    updateSequence: interval.span.sequence,
    writerUserId: interval.span.writerUserId,
    writerKeyFingerprint: interval.span.writerKeyFingerprint,
    authorityKind: authorityKindFor(interval.span),
  });
}

/**
 * Resolve op spans into non-overlapping attribution segments. Pure: the same
 * input always yields the same segments. Each (peer,counter) is credited to the
 * earliest-sequence span that covered it, and each resulting segment carries the
 * single signed upload (updateId/updateSequence) that first delivered it — the
 * per-upload provenance behind the contributor rollup. Segments are NOT coalesced
 * across uploads; a writer who edited a peer in two batches yields two segments.
 */
export function resolveEditAttribution(
  spans: readonly AttributionSpanInput[],
): DocumentEditAttributionSegment[] {
  const segments: DocumentEditAttributionSegment[] = [];
  for (const [peerId, peerSpans] of groupSpansByPeer(spans)) {
    for (const interval of claimedIntervalsForPeer(peerSpans)) {
      appendInterval(segments, peerId, interval);
    }
  }
  return segments.sort(
    (left, right) =>
      left.peerId.localeCompare(right.peerId) ||
      left.startCounter - right.startCounter,
  );
}
