// A history as a run of update blobs, its segments, that may start and end
// at any counter. Whatever the cuts, a cold reader of the segments holds the
// writer's history, and every segment matches every holder of it.
import { expect, spyOn, test } from "bun:test";
import type { LoroDoc } from "loro-crdt";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importUpdates,
  listVersionVectorSpans,
} from "./document";
import { generateHeldHistory } from "./historyHolders.testFixtures";
import {
  exportHistorySegments,
  historySegmentsImportInOrder,
} from "./historySegments";
import {
  allChanges,
  chainHistory,
  commitTimeRuns,
  expectOwnRangeExports,
  expectSameHistory,
  expectWellFormed,
  exportBound,
  FIRST_COMMIT_SECONDS,
  importInOrder,
  oneLargeCommit,
  refused,
  refusedCounter,
  restoredFromSnapshot,
  SMALL_SEGMENTS,
  segment,
  segmentCuts,
  totalBytes,
} from "./historySegments.testUtils";
import { createReadOnlyDocument } from "./historyTimeline";

test("an empty document has no segments", async () => {
  const doc = await createDocument("segments-empty");
  expect([...exportHistorySegments(doc)]).toEqual([]);
  expect(historySegmentsImportInOrder([])).toBe(true);
});

test("a document under the target is one segment, its whole update", async () => {
  const source = await oneLargeCommit("segments-whole");
  const { exports, segments } = segment(source, {});
  expect(exports).toBe(1);
  expect(segments.map(({ update }) => update)).toEqual([
    exportAllUpdates(source),
  ]);
});

// Two or three writers with concurrent branches, text past the basic plane,
// deletes in both directions, lists, maps and nested containers; the last
// two seeds add marks, movable lists, trees and counters. A map value there
// is up to 5,000 characters in one counter, which the cap must hold.
const GENERATED_SEGMENTS = { targetBytes: 1024, maxBytes: 8192 };

test.each([1, 2, 3, 4, 5, 6, 11, 13])(
  "segments rebuild a generated history and match every holder (seed %d)",
  async (seed) => {
    const held = await generateHeldHistory(seed, {
      kinds: seed > 10 ? "all" : "app",
      rounds: 12,
      sizes: [1, 5, 17, 60, 300, 900, 2200, 4200],
      writers: seed % 3 === 0 ? 3 : 2,
    });
    const [source] = held.holders.values();
    if (!source) throw new Error("No holder");
    const { exports, segments } = segment(source, GENERATED_SEGMENTS);
    expect(segments.length).toBeGreaterThan(8);
    expectWellFormed(segments, GENERATED_SEGMENTS.maxBytes);
    expect(exports).toBeLessThanOrEqual(
      exportBound(segments.length, source.opCount()),
    );
    // Segments hold several peers, and cut changes and operations.
    expect(
      Math.max(...segments.map((each) => listVersionVectorSpans(each).length)),
    ).toBeGreaterThan(1);
    const cuts = segmentCuts(source, segments);
    expect(cuts.insideChange).toBeGreaterThan(0);
    expect(cuts.insideOperation.size).toBeGreaterThan(0);
    expectOwnRangeExports(source, segments);

    const cold = importInOrder(segments);
    expectSameHistory(cold, source);
    // Writers, readers of uploads, a snapshot-restored holder, and one that
    // received the history cut at other counters.
    expect([...held.holders.keys()]).toContain("snapshot");
    expect([...held.holders.keys()]).toContain("segments");
    for (const [name, holder] of [...held.holders, ["cold", cold] as const]) {
      expect([name, refused(holder, segments)]).toEqual([name, []]);
      // Each holder's own segments cut elsewhere and rebuild the same history.
      const own = [...exportHistorySegments(holder, GENERATED_SEGMENTS)];
      expectWellFormed(own, GENERATED_SEGMENTS.maxBytes);
      expectSameHistory(importInOrder(own), source);
      expect([name, refused(source, own)]).toEqual([name, []]);
    }
    held.free();
  },
);

test("segments cut inside a change, a text insert and a list insert", async () => {
  const source = await oneLargeCommit("segments-inside");
  const { segments } = segment(source, SMALL_SEGMENTS);
  expect(segments.length).toBeGreaterThan(12);
  expectWellFormed(segments, SMALL_SEGMENTS.maxBytes);

  // The history is one commit in a few changes, so most cuts are inside one.
  const cuts = segmentCuts(source, segments);
  expect(allChanges(source).length).toBeLessThan(4);
  expect(cuts.insideChange).toBeGreaterThan(segments.length - 4);
  expect(cuts.insideOperation.get("Text insert")).toBeGreaterThan(1);
  expect(cuts.insideOperation.get("List insert")).toBeGreaterThan(1);

  const cold = importInOrder(segments);
  expectSameHistory(cold, source);
  const restored = restoredFromSnapshot(source);
  for (const holder of [source, cold, restored]) {
    expect(refused(holder, segments)).toEqual([]);
  }
  expectOwnRangeExports(source, segments);
  // These segments each hold one peer, and the identity check finds such a
  // segment equal to the holder's own export before it expands an operation.
  const expandOperations = spyOn(source, "exportJsonUpdates");
  expect(refused(source, segments)).toEqual([]);
  expect(expandOperations).not.toHaveBeenCalled();
  expandOperations.mockRestore();
});

test("one text insert many times the cap is cut into segments under it", async () => {
  const source = await createDocument("segments-large-insert");
  // Code points of one to four bytes, in stretches, so the bytes a counter
  // takes change under the segmenter by more than the cap is of the target.
  source
    .getText("text")
    .insert(
      0,
      "a".repeat(9000) +
        "𝄞".repeat(4000) +
        "é".repeat(3000) +
        "漢".repeat(3000) +
        "b".repeat(9000),
    );
  source.commit({ timestamp: FIRST_COMMIT_SECONDS });
  const sizes = { targetBytes: 512, maxBytes: 1024 };
  const whole = exportAllUpdates(source).byteLength;
  expect(whole).toBeGreaterThan(sizes.maxBytes * 40);
  const operations = source.exportJsonUpdates().changes.flatMap((c) => c.ops);
  expect(operations).toHaveLength(1);

  const { exports, segments } = segment(source, sizes);
  expectWellFormed(segments, sizes.maxBytes);
  expect(segments.length).toBeGreaterThan(whole / sizes.maxBytes);
  expect(segmentCuts(source, segments).insideOperation).toEqual(
    new Map([["Text insert", segments.length - 1]]),
  );
  // A candidate is over the cap, and exported again smaller, only where the
  // bytes per code point jump: twice here, never once per piece.
  expect(exports - segments.length).toBeGreaterThan(0);
  expect(exports - segments.length).toBeLessThanOrEqual(4);
  const cold = importInOrder(segments);
  expectSameHistory(cold, source);
  expect(refused(source, segments)).toEqual([]);
  expect(refused(cold, segments)).toEqual([]);
});

test("one counter over the cap is an error that names it", async () => {
  // One map value, after history that segments.
  const source = await chainHistory("segments-large-value", 12);
  const counter = source.opCount();
  source.getMap("fields").set("large", "v".repeat(4000));
  source.getText("text").insert(0, "after");
  source.commit({ timestamp: FIRST_COMMIT_SECONDS + 3600 });
  const { error, taken } = refusedCounter(
    exportHistorySegments(source, SMALL_SEGMENTS),
  );
  expect(error.peerId).toBe(source.peerIdStr);
  expect(error.counter).toBe(counter);
  expect(error.maxBytes).toBe(SMALL_SEGMENTS.maxBytes);
  const alone = source.export({
    mode: "updates-in-range",
    spans: [{ id: { counter, peer: source.peerIdStr }, len: 1 }],
  });
  expect(error.counterBytes).toBe(alone.byteLength);
  // The segments before it were handed over before the error.
  expect(taken).toBeGreaterThan(2);
  // A cap that holds the counter carries the history.
  const sizes = { targetBytes: 256, maxBytes: alone.byteLength };
  const fitted = [...exportHistorySegments(source, sizes)];
  expectWellFormed(fitted, sizes.maxBytes);
  expectSameHistory(importInOrder(fitted), source);

  // One list element, inside an insert of many, by a second writer. The
  // cap now holds the map value, and the element is larger.
  const second = await createDocument("segments-large-element");
  importUpdates(second, [exportAllUpdates(source)]);
  const before = second.oplogVersion().get(second.peerIdStr) ?? 0;
  const list = second.getList("items");
  for (let index = 0; index < 40; index += 1) {
    list.insert(index, index === 25 ? "e".repeat(6000) : index);
  }
  second.commit({ timestamp: FIRST_COMMIT_SECONDS + 7200 });
  const element = refusedCounter(exportHistorySegments(second, sizes));
  expect(element.error.peerId).toBe(second.peerIdStr);
  expect(element.error.counter).toBe(before + 25);
});

test("segments are gapless per peer and depend only on earlier segments", async () => {
  const chain = await chainHistory("segments-order-chain", 40);
  const links = [...exportHistorySegments(chain, SMALL_SEGMENTS)];
  expect(links.length).toBeGreaterThan(8);
  expect(historySegmentsImportInOrder(links)).toBe(true);
  for (let position = 0; position < links.length - 1; position += 1) {
    const removed = links.filter((_, index) => index !== position);
    expect(historySegmentsImportInOrder(removed)).toBe(false);
    const swapped = [
      ...links.slice(0, position),
      ...links.slice(position, position + 2).reverse(),
      ...links.slice(position + 2),
    ];
    expect(historySegmentsImportInOrder(swapped)).toBe(false);
  }
  // A prefix is a whole history of its own: a missing tail needs a count.
  expect(historySegmentsImportInOrder(links.slice(0, -1))).toBe(true);
  // A segment that repeats counters does not start where the last one ended,
  // and neither does one that skips counters, whatever it says it depends on.
  expect(historySegmentsImportInOrder([...links.slice(0, 1), ...links])).toBe(
    false,
  );
  const [head, , after] = links;
  if (!head || !after) throw new Error("expected three segments");
  const skipping = { ...after, dependencyVersionVector: emptyVersionVector() };
  expect(historySegmentsImportInOrder([head, skipping])).toBe(false);

  // Each of these starts its own peer at zero, so only the dependency of
  // the second on the first orders them.
  const first = await createDocument("segments-dependency-first");
  first.getText("text").insert(0, "first");
  first.commit();
  const second = await createDocument("segments-dependency-second");
  importUpdates(second, [exportAllUpdates(first)]);
  const held = encodeVersionVector(second);
  second.getText("text").insert(5, " second");
  second.commit();
  const ranges = [
    exportAllUpdates(first),
    exportUpdatesSince(second, held),
  ].map(getUpdateVersionVectors);
  expect(historySegmentsImportInOrder(ranges)).toBe(true);
  expect(historySegmentsImportInOrder([...ranges].reverse())).toBe(false);
});

test("a change that depends on a cut change comes after all of it", async () => {
  // Each writer builds on the other's long insert, so neither peer's
  // history can come first whole.
  const first = await createDocument("segments-across-first");
  const second = await createDocument("segments-across-second");
  first.getText("text").insert(0, "x".repeat(2000));
  first.commit({ timestamp: FIRST_COMMIT_SECONDS });
  importUpdates(second, [exportAllUpdates(first)]);
  second.getText("text").insert(2000, "y".repeat(2000));
  second.commit({ timestamp: FIRST_COMMIT_SECONDS + 60 });
  importUpdates(first, [exportAllUpdates(second)]);
  first.getText("text").insert(4000, "z".repeat(2000));
  first.commit({ timestamp: FIRST_COMMIT_SECONDS + 120 });

  const segments = [...exportHistorySegments(first, SMALL_SEGMENTS)];
  expectWellFormed(segments, SMALL_SEGMENTS.maxBytes);
  expect(segmentCuts(first, segments).insideChange).toBeGreaterThan(12);
  // All of x, then all of y, then all of z, each in several segments.
  const holding = (doc: LoroDoc, from: number) =>
    segments
      .filter((each) =>
        listVersionVectorSpans(each).some(
          (span) =>
            span.peerId === doc.peerIdStr &&
            span.startCounter < from + 2000 &&
            span.endCounter > from,
        ),
      )
      .map(({ index }) => index);
  const [x, y, z] = [
    holding(first, 0),
    holding(second, 0),
    holding(first, 2000),
  ];
  expect(Math.min(x.length, y.length, z.length)).toBeGreaterThan(4);
  expect(Math.max(...x)).toBeLessThanOrEqual(Math.min(...y));
  expect(Math.max(...y)).toBeLessThanOrEqual(Math.min(...z));
  expectSameHistory(importInOrder(segments), first);
});

test("segmenting one document is deterministic", async () => {
  const source = await oneLargeCommit("segments-deterministic");
  importUpdates(source, [
    exportAllUpdates(await chainHistory("segments-deterministic-chain", 60)),
  ]);
  const { segments } = segment(source, SMALL_SEGMENTS);
  expect([...exportHistorySegments(source, SMALL_SEGMENTS)]).toEqual(segments);
  // A holder restored from a snapshot holds the same changes and cuts alike.
  const restored = restoredFromSnapshot(source);
  expect([...exportHistorySegments(restored, SMALL_SEGMENTS)]).toEqual(
    segments,
  );
  // A reader of the segments holds a cut change in parts, so its own
  // segments can cut elsewhere. They are the same history all the same.
  const rebuilt = importInOrder(segments);
  const again = [...exportHistorySegments(rebuilt, SMALL_SEGMENTS)];
  expectSameHistory(importInOrder(again), source);
  expect(refused(source, again)).toEqual([]);

  // A range keeps its bytes while the document grows: a later commit,
  // another writer's work, and a checkpoint export.
  source.getText("text").insert(0, "later");
  source.commit({ timestamp: FIRST_COMMIT_SECONDS });
  importUpdates(source, [
    exportAllUpdates(await chainHistory("segments-deterministic-other", 3)),
  ]);
  exportFullHistorySnapshot(source);
  expectOwnRangeExports(source, segments);
});

test("segments are exported as they are asked for, of the history first held", async () => {
  const source = await chainHistory("segments-lazy", 60);
  const version = encodeVersionVector(source);
  const identity = exportFullHistoryIdentity(source);
  const before = [...exportHistorySegments(source, SMALL_SEGMENTS)];
  const exportBlob = spyOn(source, "export");
  const segments = exportHistorySegments(source, SMALL_SEGMENTS);
  expect(exportBlob).toHaveBeenCalledTimes(0);
  const first = segments.next();
  if (first.done) throw new Error("expected a segment");
  const firstExports = exportBlob.mock.calls.length;
  expect(firstExports).toBeLessThanOrEqual(2);
  // The document moves on while its segments are read: its last change
  // grows, and another writer's work arrives.
  source.getText("text").insert(0, "later");
  source.commit({ timestamp: FIRST_COMMIT_SECONDS + 59 * 60 });
  expect(allChanges(source)).toHaveLength(60);
  importUpdates(source, [
    exportAllUpdates(await chainHistory("segments-lazy-other", 3)),
  ]);
  expect(exportBlob).toHaveBeenCalledTimes(firstExports);
  const second = segments.next();
  expect(exportBlob).toHaveBeenCalledTimes(firstExports + 1);
  exportBlob.mockRestore();
  if (second.done) throw new Error("expected a second segment");

  // The segments are those the document gave before it moved on.
  const all = [first.value, second.value, ...segments];
  expect(all).toEqual(before);
  const cold = importInOrder(all);
  expect(encodeVersionVector(cold)).toBe(version);
  expect(exportFullHistoryIdentity(cold)).toBe(identity);
  expect(exportFullHistoryIdentity(source, version)).toBe(identity);
});

test("a content-heavy history costs little more as segments, one export each", async () => {
  const source = await chainHistory("segments-content", 600);
  const whole = exportAllUpdates(source).byteLength;
  const sizes = { targetBytes: 4 * 1024, maxBytes: 16 * 1024 };
  const { exports, segments } = segment(source, sizes);

  expect(segments.length).toBeGreaterThan(8);
  expectWellFormed(segments, sizes.maxBytes);
  // Only the first candidate, sized before any export, is exported twice.
  expect(exports).toBeLessThanOrEqual(segments.length + 1);
  expect(totalBytes(segments)).toBeGreaterThanOrEqual(whole);
  expect(totalBytes(segments)).toBeLessThan(whole * 1.05);
  expectSameHistory(importInOrder(segments), source);
});

test("a history of 3,000 one-operation peers segments with bounded overhead", async () => {
  const source = createReadOnlyDocument();
  const updates: Uint8Array[] = [];
  for (let peer = 0; peer < 3000; peer += 1) {
    const writer = await createDocument(`segments-many-peers-${peer}`);
    writer.getMap("fields").set(`key-${peer}`, peer);
    writer.commit({ timestamp: FIRST_COMMIT_SECONDS + peer });
    updates.push(exportAllUpdates(writer));
    writer.free();
  }
  importUpdates(source, updates);
  const whole = exportAllUpdates(source).byteLength;
  const sizes = { targetBytes: 40_000, maxBytes: 160_000 };
  const { exports, segments } = segment(source, sizes);

  expect(segments.length).toBeGreaterThan(3);
  expectWellFormed(segments, sizes.maxBytes);
  expect(exports).toBeLessThanOrEqual(segments.length + 1);
  expect(totalBytes(segments)).toBeLessThan(whole * 1.05);
  expectSameHistory(importInOrder(segments), source);
});

test("commit times survive segmentation", async () => {
  const source = await chainHistory("segments-times", 40);
  const other = await oneLargeCommit("segments-times-other");
  const firstCommit = other.opCount();
  importUpdates(other, [exportAllUpdates(source)]);
  other.getText("text").insert(0, "x".repeat(900));
  other.commit({ timestamp: FIRST_COMMIT_SECONDS + 86_400 });
  importUpdates(source, [exportAllUpdates(other)]);

  const segments = [...exportHistorySegments(source, SMALL_SEGMENTS)];
  expect(segmentCuts(source, segments).insideChange).toBeGreaterThan(10);
  const cold = importInOrder(segments);
  expect(commitTimeRuns(cold)).toEqual(commitTimeRuns(source));
  expect(commitTimeRuns(cold)).toHaveLength(42);
  expect(commitTimeRuns(cold)).toContain(
    `${other.peerIdStr}: 0-${firstCommit} at ${FIRST_COMMIT_SECONDS}`,
  );
});

test("pending operations are committed into the segments", async () => {
  const doc = await createDocument("segments-pending");
  doc.getText("text").insert(0, "committed");
  doc.commit();
  doc.getText("text").insert(0, "pending ");
  const cold = importInOrder(exportHistorySegments(doc));
  expect(cold.getText("text").toString()).toBe("pending committed");
});

test("segment sizes must be positive, with the target within the cap", async () => {
  const doc = await createDocument("segments-options");
  // Refused when called, before any segment is asked for.
  expect(() =>
    exportHistorySegments(doc, { targetBytes: 2048, maxBytes: 1024 }),
  ).toThrow(RangeError);
  expect(() => exportHistorySegments(doc, { targetBytes: 0 })).toThrow(
    RangeError,
  );
});
