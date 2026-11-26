import type { LoroDoc, PeerID } from "loro-crdt";
import {
  decodeVersionVector,
  encodeVersionVector,
  getUpdateVersionVectors,
  satisfiesVersionVector,
} from "./document";
import {
  comparePeerIds,
  type HistoryStop,
  orderHistoryStopsByLamport,
} from "./historyTimeline";
import { type OperationSpan, operationSpans } from "./versionRange";

/** The plaintext size a segment aims for. */
export const DEFAULT_HISTORY_SEGMENT_TARGET_BYTES = 4 * 1024 * 1024;
/** The plaintext size no segment exceeds. */
export const DEFAULT_HISTORY_SEGMENT_MAX_BYTES = 16 * 1024 * 1024;

/**
 * The size assumed for one counter before any export has measured one. It is
 * low on purpose: a document with fewer counters than the target has bytes is
 * tried whole, and becomes one segment in one export when it fits.
 */
const UNMEASURED_BYTES_PER_COUNTER = 1;

/** The vectors a segment declares, as `getUpdateVersionVectors` reads them. */
export interface HistorySegmentRange {
  dependencyVersionVector: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
}

/** One update blob of a document's history, and its place in the run. */
export interface HistorySegment extends HistorySegmentRange {
  index: number;
  update: Uint8Array;
}

export interface HistorySegmentSizes {
  /** Defaults to {@link DEFAULT_HISTORY_SEGMENT_TARGET_BYTES}. */
  targetBytes?: number;
  /** Defaults to {@link DEFAULT_HISTORY_SEGMENT_MAX_BYTES}. */
  maxBytes?: number;
}

/**
 * One operation counter alone is larger than a segment may be: one map
 * value, one list element, or another operation that takes a single counter.
 * A counter is the smallest thing an update can carry, so this history cannot
 * be segmented at that size. Retrying changes nothing: the value is the
 * author's own data, and only a larger cap carries it.
 */
export class HistorySegmentCounterTooLargeError extends Error {
  readonly peerId: PeerID;
  readonly counter: number;
  /** Size of the update that carries only this counter. */
  readonly counterBytes: number;
  readonly maxBytes: number;

  constructor(input: {
    peerId: PeerID;
    counter: number;
    counterBytes: number;
    maxBytes: number;
  }) {
    super(
      `Operation ${input.counter}@${input.peerId} needs ${input.counterBytes} bytes; a history segment holds at most ${input.maxBytes}`,
    );
    this.name = "HistorySegmentCounterTooLargeError";
    this.peerId = input.peerId;
    this.counter = input.counter;
    this.counterBytes = input.counterBytes;
    this.maxBytes = input.maxBytes;
  }
}

interface Sizes {
  readonly targetBytes: number;
  readonly maxBytes: number;
}

/** A place in the history: before counter `taken` of `changes[change]`. */
interface Cut {
  readonly change: number;
  readonly taken: number;
}

interface Packing extends Sizes {
  readonly doc: LoroDoc;
  /** Every change held when segmenting began, in the order segments take. */
  readonly changes: readonly HistoryStop[];
  /** Where the next segment starts. */
  cut: Cut;
  /** How many counters the segments so far have not taken. */
  remaining: number;
  /** Density of the last export, which sizes the next candidate. */
  bytesPerCounter: number;
}

/** A version range, and where the history goes on after it. */
interface Candidate {
  /** One span per peer the range touches. */
  readonly spans: OperationSpan[];
  readonly next: Cut;
}

function resolveSizes(sizes: HistorySegmentSizes): Sizes {
  const targetBytes = sizes.targetBytes ?? DEFAULT_HISTORY_SEGMENT_TARGET_BYTES;
  const maxBytes = sizes.maxBytes ?? DEFAULT_HISTORY_SEGMENT_MAX_BYTES;
  if (
    !Number.isSafeInteger(targetBytes) ||
    !Number.isSafeInteger(maxBytes) ||
    targetBytes < 1 ||
    maxBytes < targetBytes
  ) {
    throw new RangeError(
      "History segment sizes must be positive integers, with the target within the cap.",
    );
  }
  return { targetBytes, maxBytes };
}

/**
 * The document's changes in segment order, and how many counters they hold.
 * Every peer's changes must run from counter zero to the document's version
 * without a gap, or segments could not rebuild the document from nothing.
 */
function orderedChanges(doc: LoroDoc): {
  changes: HistoryStop[];
  counters: number;
} {
  const changes = orderHistoryStopsByLamport(doc.getAllChanges());
  const held = new Map<PeerID, number>();
  let counters = 0;
  for (const change of changes) {
    if (change.startCounter !== (held.get(change.peerId) ?? 0)) {
      throw new Error(
        "Document history does not run unbroken from its first operation.",
      );
    }
    held.set(change.peerId, change.endCounter);
    counters += change.endCounter - change.startCounter;
  }
  for (const [peerId, counter] of doc.oplogVersion().toJSON()) {
    if (counter !== (held.get(peerId) ?? 0)) {
      throw new Error("Document changes do not cover its version.");
    }
  }
  return { changes, counters };
}

/**
 * The next `count` counters from where the last segment ended: the rest of
 * the change it ended in, then whole changes, then the head of one more. A
 * peer's changes come in counter order, so each peer's share is one span,
 * and the candidate is a version range.
 */
function candidateRange(packing: Packing, count: number): Candidate {
  const spans = new Map<PeerID, OperationSpan>();
  let { change: position, taken } = packing.cut;
  for (let left = count; left > 0; ) {
    const change = packing.changes[position];
    if (!change) throw new Error("No history left to segment.");
    const counter = change.startCounter + taken;
    const length = Math.min(left, change.endCounter - counter);
    const span = spans.get(change.peerId);
    if (span) span.len += length;
    else {
      const id = { counter, peer: change.peerId };
      spans.set(change.peerId, { id, len: length });
    }
    left -= length;
    taken += length;
    if (counter + length === change.endCounter) {
      position += 1;
      taken = 0;
    }
  }
  return { spans: [...spans.values()], next: { change: position, taken } };
}

/**
 * One update blob of exactly `spans`. Loro's encoding of a range depends on
 * the order its spans are given in, so they go in peer order: the bytes then
 * depend on the range and on the document, not on how the range was found.
 */
function exportSpans(doc: LoroDoc, spans: OperationSpan[]): Uint8Array {
  return doc.export({
    mode: "updates-in-range",
    spans: spans.sort((left, right) =>
      comparePeerIds(left.id.peer, right.id.peer),
    ),
  });
}

/** How many counters the target has room for, at most `limit`. */
function countersWithinTarget(packing: Packing, limit: number): number {
  const room = Math.floor(packing.targetBytes / packing.bytesPerCounter);
  return Math.max(1, Math.min(limit, room));
}

function counterTooLarge(
  packing: Packing,
  counterBytes: number,
): HistorySegmentCounterTooLargeError {
  const change = packing.changes[packing.cut.change];
  if (!change) throw new Error("No history left to segment.");
  return new HistorySegmentCounterTooLargeError({
    peerId: change.peerId,
    counter: change.startCounter + packing.cut.taken,
    counterBytes,
    maxBytes: packing.maxBytes,
  });
}

/**
 * Export the next segment. A size is known only once exported, and a counter
 * is one code point, one list element or one whole operation, never a fixed
 * number of bytes. So a candidate is a number of counters, sized from the
 * bytes per counter of the last export, and kept when it fits the cap. A
 * candidate over the cap teaches the density and is retried with at most
 * half its counters, so a first candidate of `n` counters costs at most
 * `1 + ceil(log2(n))` exports, and each export reads only its own range.
 * One counter over the cap cannot be carried.
 */
function exportNextSegment(packing: Packing): Uint8Array {
  let count = countersWithinTarget(packing, packing.remaining);
  for (;;) {
    const candidate = candidateRange(packing, count);
    const update = exportSpans(packing.doc, candidate.spans);
    packing.bytesPerCounter = update.byteLength / count;
    if (update.byteLength <= packing.maxBytes) {
      packing.cut = candidate.next;
      packing.remaining -= count;
      return update;
    }
    if (count === 1) throw counterTooLarge(packing, update.byteLength);
    count = countersWithinTarget(packing, count >> 1);
  }
}

function* packSegments(
  packing: Packing,
): Generator<HistorySegment, void, undefined> {
  for (let index = 0; packing.remaining > 0; index += 1) {
    const update = exportNextSegment(packing);
    yield { index, update, ...getUpdateVersionVectors(update) };
  }
}

/**
 * Split the whole history a document holds into update blobs that rebuild it
 * when imported in order. Changes are taken by Lamport time, then peer, and a
 * segment is a stretch of their counters that may start and end at any
 * counter, inside a change or inside one long insert. Whatever follows a cut
 * inside a change depends only on the counter before it, so each segment
 * extends a real version and depends only on the segments before it. A
 * segment aims for `targetBytes` and never exceeds `maxBytes`; one counter
 * over the cap throws {@link HistorySegmentCounterTooLargeError}.
 *
 * Sizes are checked, pending operations committed (as an export commits
 * them) and the order fixed when this is called. Each segment is exported
 * only when the returned generator is asked for it, so a caller that hands
 * each one on holds one segment at a time. Operations the document gains
 * meanwhile are left out.
 */
export function exportHistorySegments(
  doc: LoroDoc,
  sizes: HistorySegmentSizes = {},
): Generator<HistorySegment, void, undefined> {
  const resolvedSizes = resolveSizes(sizes);
  doc.commit();
  const { changes, counters } = orderedChanges(doc);
  return packSegments({
    doc,
    ...resolvedSizes,
    changes,
    cut: { change: 0, taken: 0 },
    remaining: counters,
    bytesPerCounter: UNMEASURED_BYTES_PER_COUNTER,
  });
}

/**
 * The bytes of the segment that carries exactly `range`, from a document
 * that holds it, or null when the document does not hold all of it or the
 * range is empty. The document a segment came from gives that segment's
 * bytes again however much history it has gained since, so a caller can
 * check a segment it kept against the document before relying on it.
 * Another holder of the same history gives the same bytes only when it
 * groups those operations into the same changes.
 */
export function exportHistorySegmentRange(
  doc: LoroDoc,
  range: Pick<
    HistorySegmentRange,
    "partialEndVersionVector" | "partialStartVersionVector"
  >,
): Uint8Array | null {
  const spans = operationSpans(
    decodeVersionVector(range.partialStartVersionVector),
    decodeVersionVector(range.partialEndVersionVector),
  );
  if (
    !spans ||
    spans.length === 0 ||
    !satisfiesVersionVector(
      encodeVersionVector(doc),
      range.partialEndVersionVector,
    )
  ) {
    return null;
  }
  return exportSpans(doc, spans);
}

/**
 * Whether segments, in this order, import into an empty document with nothing
 * left pending and nothing skipped: each starts every peer where the earlier
 * segments left it, from zero, and depends only on operations they carry. It
 * reads the declared vectors alone, so it cannot tell that a tail is missing.
 */
export function historySegmentsImportInOrder(
  segments: Iterable<HistorySegmentRange>,
): boolean {
  const covered = new Map<PeerID, number>();
  for (const segment of segments) {
    const dependencies = decodeVersionVector(segment.dependencyVersionVector);
    const spans = operationSpans(
      decodeVersionVector(segment.partialStartVersionVector),
      decodeVersionVector(segment.partialEndVersionVector),
    );
    const held = (peerId: PeerID) => covered.get(peerId) ?? 0;
    if (
      !spans ||
      [...dependencies.toJSON()].some(
        ([peerId, counter]) => held(peerId) < counter,
      ) ||
      spans.some(({ id }) => held(id.peer) !== id.counter)
    ) {
      return false;
    }
    for (const { id, len } of spans) covered.set(id.peer, id.counter + len);
  }
  return true;
}
