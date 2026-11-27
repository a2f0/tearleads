// A run of segments continued after the document gained history: the
// segments handed on already stand, and the rest follow where they end.
import { expect, test } from "bun:test";
import type { LoroDoc, PeerID } from "loro-crdt";
import { VersionVector } from "loro-crdt";
import {
  createDocument,
  decodeVersionVector,
  encodeEncodedVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
  listVersionVectorSpans,
} from "./document";
import {
  exportHistorySegments,
  type HistorySegment,
  historySegmentsImportInOrder,
} from "./historySegments";
import {
  chainHistory,
  expectSameHistory,
  importInOrder,
  SMALL_SEGMENTS,
} from "./historySegments.testUtils";

/** Where a run of segments leaves every peer it carries. */
function frontierOf(segments: readonly HistorySegment[]): string {
  const reached = new Map<PeerID, number>();
  for (const segment of segments) {
    for (const [peer, counter] of decodeVersionVector(
      segment.partialEndVersionVector,
    ).toJSON()) {
      reached.set(peer, Math.max(reached.get(peer) ?? 0, counter));
    }
  }
  return encodeEncodedVersionVector(VersionVector.parseJSON(reached));
}

/** A second writer whose edits are concurrent with most of `source`. */
async function concurrentWriter(source: LoroDoc, label: string) {
  const writer = await createDocument(label);
  const early = [...exportHistorySegments(source, SMALL_SEGMENTS)][0];
  if (!early) throw new Error("No history to fork");
  importUpdates(writer, [early.update]);
  const text = writer.getText("text");
  for (let commit = 0; commit < 6; commit += 1) {
    text.insert(0, `concurrent ${commit} ${"ipsum ".repeat(20)}\n`);
    writer.commit();
  }
  return writer;
}

test("segments after a handed-on run continue it once the history grows", async () => {
  const source = await chainHistory("segments-after", 40);
  const handedOn = [...exportHistorySegments(source, SMALL_SEGMENTS)].slice(
    0,
    -1,
  );
  expect(handedOn.length).toBeGreaterThan(3);
  const after = frontierOf(handedOn);

  // Edits concurrent with the handed-on segments sort among them by Lamport
  // time, so the grown history's own segments are other segments.
  const writer = await concurrentWriter(source, "segments-after-writer");
  importUpdates(source, [exportAllUpdates(writer)]);
  const regrown = [...exportHistorySegments(source, SMALL_SEGMENTS)];
  expect(
    regrown
      .slice(0, handedOn.length)
      .map((segment) => segment.partialEndVersionVector),
  ).not.toEqual(handedOn.map((segment) => segment.partialEndVersionVector));

  const tail = [...exportHistorySegments(source, SMALL_SEGMENTS, after)];
  expect(tail.length).toBeGreaterThan(1);
  expect(tail.map((segment) => segment.index)).toEqual(tail.map((_, i) => i));
  // Nothing the handed-on run carries is sent again.
  const held = decodeVersionVector(after);
  for (const span of tail.flatMap(listVersionVectorSpans)) {
    expect(span.startCounter).toBeGreaterThanOrEqual(
      held.get(span.peerId) ?? 0,
    );
  }
  const run = [...handedOn, ...tail];
  expect(historySegmentsImportInOrder(run)).toBe(true);
  expectSameHistory(importInOrder(run), source);
});

test("segments after the document's own version are none", async () => {
  const source = await chainHistory("segments-after-all", 5);
  expect([
    ...exportHistorySegments(source, {}, encodeVersionVector(source)),
  ]).toEqual([]);
});

test("segments cannot follow a version the document does not hold", async () => {
  const source = await chainHistory("segments-after-ahead", 5);
  const ahead = await chainHistory("segments-after-ahead-other", 2);
  expect(() =>
    exportHistorySegments(source, {}, encodeVersionVector(ahead)),
  ).toThrow("Document does not hold the version its segments follow.");
});
