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

function canCoalesce(
  previous: DocumentEditAttributionSegment | undefined,
  peerId: string,
  interval: ClaimedInterval,
  authorityKind: EditAttributionAuthorityKind,
): previous is DocumentEditAttributionSegment {
  return (
    previous !== undefined &&
    previous.peerId === peerId &&
    previous.endCounter === interval.start &&
    previous.writerUserId === interval.span.writerUserId &&
    previous.writerKeyFingerprint === interval.span.writerKeyFingerprint &&
    previous.authorityKind === authorityKind
  );
}

function appendInterval(
  segments: DocumentEditAttributionSegment[],
  peerId: string,
  interval: ClaimedInterval,
): void {
  const authorityKind = authorityKindFor(interval.span);
  const previous = segments[segments.length - 1];
  if (canCoalesce(previous, peerId, interval, authorityKind)) {
    segments[segments.length - 1] = { ...previous, endCounter: interval.end };
    return;
  }
  segments.push({
    peerId,
    startCounter: interval.start,
    endCounter: interval.end,
    writerUserId: interval.span.writerUserId,
    writerKeyFingerprint: interval.span.writerKeyFingerprint,
    authorityKind,
  });
}

/**
 * Resolve op spans into non-overlapping attribution segments. Pure: the same
 * input always yields the same segments. Each (peer,counter) is credited to the
 * earliest-sequence span that covered it; contiguous counters with identical
 * (writer, authorityKind) are coalesced.
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
