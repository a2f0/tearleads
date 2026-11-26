// Helpers for the history segment tests: hand-built histories, a cold reader,
// and where a run of segments cut the history it came from.
import { expect, spyOn } from "bun:test";
import { type Change, idStrToId, type LoroDoc, type PeerID } from "loro-crdt";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  getImportBlobMetadata,
  getUpdateVersionVectors,
  importSnapshot,
  importUpdates,
  listVersionVectorSpans,
  versionVectorsEqual,
} from "./document";
import {
  exportHistorySegmentRange,
  exportHistorySegments,
  type HistorySegment,
  HistorySegmentCounterTooLargeError,
  type HistorySegmentSizes,
  historySegmentsImportInOrder,
} from "./historySegments";
import { createReadOnlyDocument } from "./historyTimeline";
import { updateMatchesDocumentHistory } from "./updateIdentity";

/** Sizes small enough that a short history takes many segments. */
export const SMALL_SEGMENTS = { targetBytes: 256, maxBytes: 1024 };
export const FIRST_COMMIT_SECONDS = 1_700_000_000;

/** One peer, one commit a minute, so every change depends on the one before. */
export async function chainHistory(
  label: string,
  commits: number,
): Promise<LoroDoc> {
  const doc = await createDocument(label);
  const text = doc.getText("text");
  for (let commit = 0; commit < commits; commit += 1) {
    text.insert(text.length, `paragraph ${commit} ${"lorem ".repeat(12)}\n`);
    doc.commit({ timestamp: FIRST_COMMIT_SECONDS + commit * 60 });
  }
  return doc;
}

/**
 * One commit by one writer that holds a long text insert past the basic
 * plane, a long list insert, map values, and a delete run in each direction.
 * Loro stores it as a few changes of its own choosing.
 */
export async function oneLargeCommit(label: string): Promise<LoroDoc> {
  const doc = await createDocument(label);
  const text = doc.getText("text");
  text.insert(0, "a𝄞漢é".repeat(700) + "b".repeat(1500));
  const list = doc.getList("items");
  for (let index = 0; index < 700; index += 1) {
    list.insert(index, index % 3 === 0 ? `value-${index}` : index);
  }
  for (let key = 0; key < 30; key += 1) {
    doc.getMap("fields").set(`key-${key}`, "v".repeat(40 + key));
  }
  // In the plain tail: the delete key, in place; then backspace, moving left.
  for (let count = 0; count < 300; count += 1) text.delete(3600, 1);
  for (let at = 4600; at > 4300; at -= 1) text.delete(at, 1);
  doc.commit({ timestamp: FIRST_COMMIT_SECONDS });
  return doc;
}

export function allChanges(doc: LoroDoc): Change[] {
  return [...doc.getAllChanges().values()].flat();
}

/** Every segment of `doc`, and how many exports the segmenter made. */
export function segment(
  doc: LoroDoc,
  sizes: HistorySegmentSizes,
): { exports: number; segments: HistorySegment[] } {
  const exportBlob = spyOn(doc, "export");
  try {
    const segments = [...exportHistorySegments(doc, sizes)];
    return { exports: exportBlob.mock.calls.length, segments };
  } finally {
    exportBlob.mockRestore();
  }
}

/** A cold reader: an empty document that imports one segment at a time. */
export function importInOrder(segments: Iterable<HistorySegment>): LoroDoc {
  const cold = createReadOnlyDocument();
  for (const { update } of segments) importUpdates(cold, [update]);
  return cold;
}

export function expectSameHistory(holder: LoroDoc, source: LoroDoc): void {
  expect(
    versionVectorsEqual(
      encodeVersionVector(holder),
      encodeVersionVector(source),
    ),
  ).toBe(true);
  expect(holder.toJSON()).toEqual(source.toJSON());
  expect(exportFullHistoryIdentity(holder)).toBe(
    exportFullHistoryIdentity(source),
  );
}

export function totalBytes(segments: readonly HistorySegment[]): number {
  return segments.reduce((sum, { update }) => sum + update.byteLength, 0);
}

function largestBytes(segments: readonly HistorySegment[]): number {
  return Math.max(...segments.map(({ update }) => update.byteLength));
}

/** The most exports `segments` may have cost a history of `counters`. */
export function exportBound(segments: number, counters: number): number {
  return segments * (1 + Math.ceil(Math.log2(counters)));
}

interface HeldOperation {
  readonly counter: number;
  readonly length: number;
  /** Such as `Text insert` or `List delete`. */
  readonly kind: string;
}

function operationLength(content: object): number {
  if ("text" in content && typeof content.text === "string") {
    return [...content.text].length;
  }
  if ("value" in content && Array.isArray(content.value)) {
    return content.value.length;
  }
  if ("len" in content && typeof content.len === "number") {
    return Math.abs(content.len);
  }
  return 1;
}

function heldOperations(doc: LoroDoc): Map<PeerID, HeldOperation[]> {
  const held = new Map<PeerID, HeldOperation[]>();
  for (const change of doc.exportJsonUpdates(undefined, undefined, false)
    .changes) {
    const { peer } = idStrToId(change.id);
    const operations = change.ops.map((op) => ({
      counter: op.counter,
      kind: `${op.container.split(":").pop()} ${op.content.type}`,
      length: operationLength(op.content),
    }));
    held.set(peer, [...(held.get(peer) ?? []), ...operations]);
  }
  return held;
}

export interface SegmentCuts {
  /** Cuts at a counter that does not start a change `doc` holds. */
  insideChange: number;
  /** Cuts at a counter that does not start an operation, by its kind. */
  insideOperation: Map<string, number>;
}

/**
 * Where `segments` cut `doc`'s history: every counter past zero at which a
 * segment starts a peer, set against the changes and operations `doc` holds.
 */
export function segmentCuts(
  doc: LoroDoc,
  segments: readonly HistorySegment[],
): SegmentCuts {
  const changeStarts = new Set(
    allChanges(doc).map((change) => `${change.counter}@${change.peer}`),
  );
  const operations = heldOperations(doc);
  const cuts: SegmentCuts = { insideChange: 0, insideOperation: new Map() };
  for (const cut of segments.flatMap(listVersionVectorSpans)) {
    if (cut.startCounter === 0) continue;
    if (!changeStarts.has(`${cut.startCounter}@${cut.peerId}`)) {
      cuts.insideChange += 1;
    }
    const inside = operations
      .get(cut.peerId)
      ?.find(
        ({ counter, length }) =>
          counter < cut.startCounter && cut.startCounter < counter + length,
      );
    if (!inside) continue;
    const seen = cuts.insideOperation.get(inside.kind) ?? 0;
    cuts.insideOperation.set(inside.kind, seen + 1);
  }
  return cuts;
}

/** Each peer's commit times as runs of counters, however changes split them. */
export function commitTimeRuns(doc: LoroDoc): string[] {
  const runs: string[] = [];
  for (const [peer, changes] of doc.getAllChanges()) {
    let start = 0;
    let time: number | null = null;
    for (const change of changes) {
      if (time !== null && change.timestamp !== time) {
        runs.push(`${peer}: ${start}-${change.counter} at ${time}`);
        start = change.counter;
      }
      time = change.timestamp;
    }
    const last = changes.at(-1);
    if (last) runs.push(`${peer}: ${start}-end at ${last.timestamp}`);
  }
  return runs.sort();
}

/** The segments that do not match `holder`'s history, by index. */
export function refused(holder: LoroDoc, segments: readonly HistorySegment[]) {
  return segments
    .filter(({ update }) => !updateMatchesDocumentHistory(holder, update))
    .map(({ index }) => index);
}

/** Each segment is `holder`'s own export of the range it declares. */
export function expectOwnRangeExports(
  holder: LoroDoc,
  segments: readonly HistorySegment[],
): void {
  for (const { update, index, ...range } of segments) {
    const own = exportHistorySegmentRange(holder, range);
    expect([index, own?.byteLength]).toEqual([index, update.byteLength]);
    expect(own).toEqual(update);
  }
}

export function restoredFromSnapshot(source: LoroDoc): LoroDoc {
  const restored = createReadOnlyDocument();
  importSnapshot(restored, exportFullHistorySnapshot(source));
  return restored;
}

/** What every run of segments is, whatever history it came from. */
export function expectWellFormed(
  segments: readonly HistorySegment[],
  maxBytes: number,
): void {
  expect(segments.map(({ index }) => index)).toEqual(
    segments.map((_, position) => position),
  );
  for (const { update, index: _index, ...vectors } of segments) {
    expect(getImportBlobMetadata(update).mode).toBe("update");
    expect(vectors).toEqual(getUpdateVersionVectors(update));
  }
  expect(largestBytes(segments)).toBeLessThanOrEqual(maxBytes);
  expect(historySegmentsImportInOrder(segments)).toBe(true);
}

/** Reads `segments` until a counter is refused; `taken` came before it. */
export function refusedCounter(segments: Iterable<HistorySegment>): {
  error: HistorySegmentCounterTooLargeError;
  taken: number;
} {
  let taken = 0;
  try {
    for (const _segment of segments) taken += 1;
  } catch (error) {
    if (error instanceof HistorySegmentCounterTooLargeError) {
      return { error, taken };
    }
    throw error;
  }
  throw new Error("expected a counter to be refused");
}
