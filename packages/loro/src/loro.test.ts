import { expect, test } from "bun:test";
import {
  createDocument,
  derivePeerId,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importSnapshot,
  importUpdates,
  listSnapshotCharBlameSource,
  listSnapshotCharOpIds,
  listSnapshotFieldEditors,
  listTextCharOpIds,
  listVersionVectorSpans,
} from "./index";

test("loro peers converge on the same text via exported updates", async () => {
  const aliceDoc = await createDocument("alice-seed");
  const bobDoc = await createDocument("bob-seed");

  const initialVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("hello");
  const aliceUpdate = exportUpdatesSince(aliceDoc, initialVersion);
  importUpdates(bobDoc, [aliceUpdate]);
  expect(getTextValue(bobDoc)).toBe("hello");

  const bobVersion = encodeVersionVector(bobDoc);
  bobDoc.getText("text").update("hello world");
  const bobUpdate = exportUpdatesSince(bobDoc, bobVersion);
  importUpdates(aliceDoc, [bobUpdate]);
  expect(getTextValue(aliceDoc)).toBe("hello world");
});

test("listVersionVectorSpans extracts changed peer counter ranges", async () => {
  const peerSeed = "span-peer";
  const doc = await createDocument(peerSeed);
  const expectedPeerId = await derivePeerId(peerSeed);

  const initialVersion = encodeVersionVector(doc);
  doc.getText("text").update("hello");
  const firstUpdate = exportUpdatesSince(doc, initialVersion);
  const firstSpans = listVersionVectorSpans(
    getUpdateVersionVectors(firstUpdate),
  );

  expect(firstSpans).toHaveLength(1);
  expect(firstSpans[0]?.peerId).toBe(expectedPeerId);
  expect(firstSpans[0]?.startCounter).toBe(0);
  expect(firstSpans[0]?.endCounter).toBeGreaterThan(0);

  const secondStartVersion = encodeVersionVector(doc);
  doc.getText("text").update("hello world");
  const secondUpdate = exportUpdatesSince(doc, secondStartVersion);
  const secondSpans = listVersionVectorSpans(
    getUpdateVersionVectors(secondUpdate),
  );

  expect(secondSpans).toHaveLength(1);
  expect(secondSpans[0]?.peerId).toBe(expectedPeerId);
  expect(secondSpans[0]?.startCounter).toBe(firstSpans[0]?.endCounter);
  expect(secondSpans[0]?.endCounter).toBeGreaterThan(
    secondSpans[0]?.startCounter ?? 0,
  );
});

test("a peer delta applies on top of a reloaded snapshot", async () => {
  const author = await createDocument("author-seed");
  author.getText("text").insert(0, "base");
  author.commit();

  // Reader reconstructs from the snapshot (single import, not batch).
  const reader = await createDocument("reader-seed");
  importSnapshot(reader, exportFullHistorySnapshot(author));
  expect(getTextValue(reader)).toBe("base");

  // The author keeps editing; the delta since the snapshot still merges
  // cleanly.
  const since = encodeVersionVector(reader);
  author.getText("text").insert(4, "+more");
  author.commit();
  importUpdates(reader, [exportUpdatesSince(author, since)]);
  expect(getTextValue(reader)).toBe("base+more");
});

test("a full-history rotation checkpoint merges concurrent edits into a behind document", async () => {
  const author = await createDocument("rotation-author");
  const empty = encodeVersionVector(author);
  author.getText("text").update("base");
  author.commit();

  const behind = await createDocument("rotation-behind");
  importUpdates(behind, [exportUpdatesSince(author, empty)]);
  behind.getText("text").insert(4, " local");
  behind.commit();

  author.getText("text").insert(4, " remote");
  author.commit();
  importSnapshot(behind, exportFullHistorySnapshot(author));

  expect(getTextValue(behind)).toContain(" local");
  expect(getTextValue(behind)).toContain(" remote");
});

test("full-history export fails closed on a history-trimmed document", async () => {
  const author = await createDocument("trimmed-rotation-author");
  author.getText("text").update("hello before rotation");
  author.commit();
  // The wrapper no longer produces history-trimmed blobs, but a foreign or
  // legacy source still can — go through the raw loro-crdt export to prove
  // the exporter refuses to launder one into a "full history" snapshot.
  const restarted = await createDocument("trimmed-rotation-author");
  importSnapshot(
    restarted,
    author.export({ frontiers: author.frontiers(), mode: "shallow-snapshot" }),
  );

  expect(() => exportFullHistorySnapshot(restarted)).toThrow(
    "restored from an incomplete source",
  );
});

test("importUpdates rejects a dependency-bearing update", async () => {
  const author = await createDocument("pending-author");
  author.getText("text").update("hello");
  author.commit();
  const base = encodeVersionVector(author);
  author.getText("text").insert(5, " world");
  author.commit();

  // The delta since `base` depends on ops a newcomer has never seen.
  const dependencyBearingUpdate = exportUpdatesSince(author, base);
  const newcomer = await createDocument("pending-newcomer");

  expect(() => importUpdates(newcomer, [dependencyBearingUpdate])).toThrow(
    "unresolved pending dependencies",
  );
});

test("listTextCharOpIds maps each character to its inserting op id", async () => {
  const alice = await createDocument("alice-seed");
  const bob = await createDocument("bob-seed");
  const alicePeer = await derivePeerId("alice-seed");
  const bobPeer = await derivePeerId("bob-seed");

  const base = encodeVersionVector(alice);
  alice.getText("text").update("hello");
  importUpdates(bob, [exportUpdatesSince(alice, base)]);
  // bob inserts in the middle; alice's original op counters are preserved, so
  // each character stays blamed to the op that actually inserted it.
  bob.getText("text").insert(2, "XY");
  bob.commit();

  expect(getTextValue(bob)).toBe("heXYllo");
  expect(listTextCharOpIds(bob)).toEqual([
    { peerId: alicePeer, counter: 0 }, // h
    { peerId: alicePeer, counter: 1 }, // e
    { peerId: bobPeer, counter: 0 }, // X
    { peerId: bobPeer, counter: 1 }, // Y
    { peerId: alicePeer, counter: 2 }, // l
    { peerId: alicePeer, counter: 3 }, // l
    { peerId: alicePeer, counter: 4 }, // o
  ]);
});

test("listTextCharOpIds returns an empty array for empty prose", async () => {
  const doc = await createDocument("blank-seed");
  expect(listTextCharOpIds(doc)).toEqual([]);
});

test("listTextCharOpIds yields one op id per code point for astral characters", async () => {
  const doc = await createDocument("emoji-seed");
  const peerId = await derivePeerId("emoji-seed");
  // Prose that opens with an emoji and embeds a ZWJ family + skin-tone sequence:
  // each code point is one Loro op, but several span two UTF-16 units. Blame must
  // stay one op id per code point (no crash on the leading surrogate, no
  // double-counting of surrogate halves).
  const value = "😀a👨‍👧b👍🏽";
  doc.getText("text").update(value);
  doc.commit();

  const opIds = listTextCharOpIds(doc);
  expect(opIds).toHaveLength([...value].length);
  // Counters run 0..n in code-point order, all from the single authoring peer.
  expect(opIds).toEqual(
    [...value].map((_char, index) => ({ peerId, counter: index })),
  );
});

test("listSnapshotCharOpIds reconstructs op ids from a persisted snapshot", async () => {
  const alice = await createDocument("alice-seed");
  const bob = await createDocument("bob-seed");
  const alicePeer = await derivePeerId("alice-seed");
  const bobPeer = await derivePeerId("bob-seed");

  const base = encodeVersionVector(alice);
  alice.getText("text").update("hello");
  importUpdates(bob, [exportUpdatesSince(alice, base)]);
  bob.getText("text").insert(2, "XY");
  bob.commit();

  // Reading blame off a rebuilt doc must match reading it off the live doc —
  // including the original per-peer authorship of every surviving character.
  const snapshot = exportFullHistorySnapshot(bob);
  const opIds = listSnapshotCharOpIds(snapshot, 100);
  expect(opIds).toEqual(listTextCharOpIds(bob));
  expect(opIds).toEqual([
    { peerId: alicePeer, counter: 0 },
    { peerId: alicePeer, counter: 1 },
    { peerId: bobPeer, counter: 0 },
    { peerId: bobPeer, counter: 1 },
    { peerId: alicePeer, counter: 2 },
    { peerId: alicePeer, counter: 3 },
    { peerId: alicePeer, counter: 4 },
  ]);
  // "heXYllo" is 7 chars; a tighter cap refuses to scan oversized prose.
  expect(listSnapshotCharOpIds(snapshot, 6)).toBeNull();
});

test("listSnapshotCharBlameSource returns aligned code points and op ids", async () => {
  const alice = await createDocument("alice-seed");
  const bob = await createDocument("bob-seed");
  const alicePeer = await derivePeerId("alice-seed");
  const bobPeer = await derivePeerId("bob-seed");

  const base = encodeVersionVector(alice);
  alice.getText("text").update("hello");
  importUpdates(bob, [exportUpdatesSince(alice, base)]);
  bob.getText("text").insert(2, "XY");
  bob.commit();

  const snapshot = exportFullHistorySnapshot(bob);
  const source = listSnapshotCharBlameSource(snapshot, 100);
  // The code points reconstruct the current prose, one entry per op id, so the
  // per-range blame view can render the text it blames from a single pass.
  expect(source?.codePoints.join("")).toBe("heXYllo");
  expect(source?.opIds).toEqual(listSnapshotCharOpIds(snapshot, 100) ?? []);
  expect(source?.opIds).toEqual([
    { peerId: alicePeer, counter: 0 },
    { peerId: alicePeer, counter: 1 },
    { peerId: bobPeer, counter: 0 },
    { peerId: bobPeer, counter: 1 },
    { peerId: alicePeer, counter: 2 },
    { peerId: alicePeer, counter: 3 },
    { peerId: alicePeer, counter: 4 },
  ]);
  // Same soft cap as listSnapshotCharOpIds.
  expect(listSnapshotCharBlameSource(snapshot, 6)).toBeNull();
});

test("listSnapshotFieldEditors names the last editor of each field", async () => {
  const alice = await createDocument("alice-seed");
  const bob = await createDocument("bob-seed");
  const alicePeer = await derivePeerId("alice-seed");
  const bobPeer = await derivePeerId("bob-seed");

  const base = encodeVersionVector(alice);
  alice.getMap("fields").set("firstName", "Ada");
  alice.getMap("fields").set("lastName", "Lovelace");
  alice.commit();
  importUpdates(bob, [exportUpdatesSince(alice, base)]);
  // bob overwrites lastName; the field's last-writer-wins register keeps bob's
  // peer while firstName stays credited to alice.
  bob.getMap("fields").set("lastName", "Byron");
  bob.commit();

  // Reads identically off a rebuilt snapshot as off the live doc.
  expect(
    listSnapshotFieldEditors(exportFullHistorySnapshot(bob), "fields"),
  ).toEqual([
    { key: "firstName", peerId: alicePeer },
    { key: "lastName", peerId: bobPeer },
  ]);
});

test("listSnapshotFieldEditors returns an empty array when the map is absent", async () => {
  const doc = await createDocument("blank-seed");
  doc.getText("text").update("just prose");
  doc.commit();
  expect(
    listSnapshotFieldEditors(exportFullHistorySnapshot(doc), "fields"),
  ).toEqual([]);
});
