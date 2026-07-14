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

interface OrderedSpan {
  readonly inputOrder: number;
  readonly span: AttributionSpanInput;
}

function authorityKindFor(
  span: AttributionSpanInput,
): EditAttributionAuthorityKind {
  return span.isBaseline ? "baseline" : "direct";
}

function groupSpansByPeer(
  spans: readonly AttributionSpanInput[],
): Map<string, OrderedSpan[]> {
  const spansByPeer = new Map<string, OrderedSpan[]>();
  for (const [inputOrder, span] of spans.entries()) {
    if (span.endCounter <= span.startCounter) {
      continue;
    }
    const peerSpans = spansByPeer.get(span.peerId) ?? [];
    peerSpans.push({ inputOrder, span });
    spansByPeer.set(span.peerId, peerSpans);
  }
  return spansByPeer;
}

function readInt32(
  values: Int32Array,
  index: number,
  errorMessage: string,
): number {
  const value = values[index];
  if (value === undefined) {
    throw new Error(errorMessage);
  }
  return value;
}

function findFirstUnclaimed(parent: Int32Array, index: number): number {
  let root = index;
  let rootParent = readInt32(
    parent,
    root,
    "Attribution interval index was out of bounds.",
  );
  while (rootParent !== root) {
    root = rootParent;
    rootParent = readInt32(
      parent,
      root,
      "Attribution interval parent was out of bounds.",
    );
  }

  let current = index;
  let currentParent = readInt32(
    parent,
    current,
    "Attribution interval index was out of bounds.",
  );
  while (currentParent !== current) {
    const next = currentParent;
    parent[current] = root;
    current = next;
    currentParent = readInt32(
      parent,
      current,
      "Attribution interval parent was out of bounds.",
    );
  }

  return root;
}

function claimedIntervalsForPeer(
  peerSpans: readonly OrderedSpan[],
): ClaimedInterval[] {
  const counterSet = new Set<number>();
  for (const { span } of peerSpans) {
    counterSet.add(span.startCounter);
    counterSet.add(span.endCounter);
  }
  const counters = [...counterSet].sort((left, right) => left - right);
  const counterIndexes = new Map(
    counters.map((counter, index) => [counter, index] as const),
  );

  // Each slot represents [counters[index], counters[index + 1]). Processing
  // spans by receive order and assigning only unclaimed slots makes the first
  // covering upload win. The disjoint-set successor skips every slot after its
  // first assignment, so interval subtraction is O(n log n) overall instead
  // of rescanning all prior claimed intervals for every span.
  const firstUnclaimed = new Int32Array(counters.length);
  for (let index = 0; index < firstUnclaimed.length; index += 1) {
    firstUnclaimed[index] = index;
  }
  const ownerBySlot = new Int32Array(Math.max(0, counters.length - 1));
  ownerBySlot.fill(-1);

  const spansByPriority = [...peerSpans].sort(
    (left, right) =>
      left.span.sequence - right.span.sequence ||
      left.inputOrder - right.inputOrder,
  );
  for (const [owner, { span }] of spansByPriority.entries()) {
    const startIndex = counterIndexes.get(span.startCounter);
    const endIndex = counterIndexes.get(span.endCounter);
    if (startIndex === undefined || endIndex === undefined) {
      throw new Error("Attribution span boundary was not indexed.");
    }

    let slot = findFirstUnclaimed(firstUnclaimed, startIndex);
    while (slot < endIndex) {
      ownerBySlot[slot] = owner;
      firstUnclaimed[slot] = findFirstUnclaimed(firstUnclaimed, slot + 1);
      slot = readInt32(
        firstUnclaimed,
        slot,
        "Attribution interval successor was out of bounds.",
      );
    }
  }

  const claimed: ClaimedInterval[] = [];
  for (let slot = 0; slot < ownerBySlot.length; slot += 1) {
    const owner = readInt32(
      ownerBySlot,
      slot,
      "Attribution interval owner was out of bounds.",
    );
    if (owner < 0) {
      continue;
    }
    const orderedSpan = spansByPriority[owner];
    const start = counters[slot];
    const end = counters[slot + 1];
    if (!orderedSpan || start === undefined || end === undefined) {
      throw new Error("Attribution interval owner was not indexed.");
    }

    const previous = claimed.at(-1);
    if (previous?.span === orderedSpan.span && previous.end === start) {
      previous.end = end;
    } else {
      claimed.push({ start, end, span: orderedSpan.span });
    }
  }

  return claimed;
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
