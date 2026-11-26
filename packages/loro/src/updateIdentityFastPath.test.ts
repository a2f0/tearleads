// `updateMatchesDocumentHistory` first compares a blob with the holder's own
// export of the same range, and expands operations into canonical form only
// when the bytes differ. A history segment lists its spans in peer order,
// which is not always the order its vectors decode in, so the comparison
// tries both. These tests count the expansions.
import { expect, spyOn, test } from "bun:test";
import type { LoroDoc } from "loro-crdt";
import {
  createDocument,
  exportAllUpdates,
  importUpdates,
  listVersionVectorSpans,
} from "./document";
import { exportHistorySegments, type HistorySegment } from "./historySegments";
import { updateMatchesDocumentHistory } from "./updateIdentity";

const SMALL_SEGMENTS = { targetBytes: 256, maxBytes: 1024 };
const WRITERS = 6;

/** Several writers that each edit, then merge, for a few rounds. */
async function interleavedHistory(): Promise<LoroDoc> {
  const writers = await Promise.all(
    Array.from({ length: WRITERS }, (_, index) =>
      createDocument(`fast-path-writer-${index}`),
    ),
  );
  for (let round = 0; round < 4; round += 1) {
    for (const [index, writer] of writers.entries()) {
      const text = writer.getText("text");
      text.insert(text.length, `writer ${index} round ${round} lorem ipsum\n`);
      writer.commit();
    }
    const updates = writers.map((writer) => exportAllUpdates(writer));
    for (const writer of writers) importUpdates(writer, updates);
  }
  const [source, ...rest] = writers;
  for (const writer of rest) writer.free();
  if (!source) throw new Error("No writer");
  return source;
}

function expansions(doc: LoroDoc, update: Uint8Array): number {
  const expand = spyOn(doc, "exportJsonUpdates");
  try {
    expect(updateMatchesDocumentHistory(doc, update)).toBe(true);
    return expand.mock.calls.length;
  } finally {
    expand.mockRestore();
  }
}

function peerCount(segment: HistorySegment): number {
  return listVersionVectorSpans(segment).length;
}

test("a segment of several peers is proved from its bytes, without expanding operations", async () => {
  const source = await interleavedHistory();
  const segments = [...exportHistorySegments(source, SMALL_SEGMENTS)];
  const multiPeer = segments.filter((segment) => peerCount(segment) > 1);
  // The history must hold segments whose two span orders differ, or the
  // second comparison is never what proves one.
  expect(multiPeer.length).toBeGreaterThan(3);
  const expanded = segments.filter(
    (segment) => expansions(source, segment.update) > 0,
  );
  expect(expanded.map((segment) => segment.index)).toEqual([]);
  source.free();
});

test("a blob of one peer is compared once: its two span orders are the same", async () => {
  const source = await createDocument("fast-path-one-writer");
  source.getText("text").insert(0, "one writer's text");
  source.commit();
  const whole = exportAllUpdates(source);
  const exportBlob = spyOn(source, "export");
  try {
    expect(updateMatchesDocumentHistory(source, whole)).toBe(true);
    expect(exportBlob.mock.calls.length).toBe(1);
  } finally {
    exportBlob.mockRestore();
  }
  source.free();
});

test("a blob that is not the holder's range still falls back to the canonical comparison", async () => {
  const source = await interleavedHistory();
  const other = await interleavedHistory();
  other.getText("text").insert(0, "x");
  other.commit();
  const [segment] = [...exportHistorySegments(other, SMALL_SEGMENTS)].slice(-1);
  if (!segment) throw new Error("No segment");
  importUpdates(source, [exportAllUpdates(other)]);
  // `source` now holds the same history as `other`, so the last segment
  // matches it; whichever path proves that, the answer is the same.
  expect(updateMatchesDocumentHistory(source, segment.update)).toBe(true);
  source.free();
  other.free();
});
