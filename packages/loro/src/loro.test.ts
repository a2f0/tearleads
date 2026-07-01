import { expect, test } from "bun:test";
import {
  createDocument,
  derivePeerId,
  encodeVersionVector,
  exportAllUpdates,
  exportShallowSnapshot,
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

test("shallow snapshot round-trips state but stays bounded by state, not history", async () => {
  const doc = await createDocument("author-seed");
  const text = doc.getText("text");
  // Churn: accumulate lots of history while the final state stays tiny.
  for (let i = 0; i < 500; i++) {
    text.insert(text.length, "scratch ");
    doc.commit();
    text.delete(text.length - 8, 8);
    doc.commit();
  }
  text.insert(0, "kept");
  doc.commit();

  const full = exportAllUpdates(doc);
  const shallow = exportShallowSnapshot(doc);
  // History dwarfs state, so the shallow snapshot is dramatically smaller.
  expect(shallow.length).toBeLessThan(full.length / 5);

  const reloaded = await createDocument("author-seed");
  importSnapshot(reloaded, shallow);
  expect(getTextValue(reloaded)).toBe("kept");
  expect(encodeVersionVector(reloaded)).toBe(encodeVersionVector(doc));
});

test("a peer delta applies on top of a reloaded shallow snapshot", async () => {
  const author = await createDocument("author-seed");
  author.getText("text").insert(0, "base");
  author.commit();

  // Reader reconstructs from the shallow snapshot (single import, not batch).
  const reader = await createDocument("reader-seed");
  importSnapshot(reader, exportShallowSnapshot(author));
  expect(getTextValue(reader)).toBe("base");

  // The author keeps editing; the delta since the snapshot still merges cleanly,
  // proving trimmed history below the cut does not break forward convergence.
  const since = encodeVersionVector(reader);
  author.getText("text").insert(4, "+more");
  author.commit();
  importUpdates(reader, [exportUpdatesSince(author, since)]);
  expect(getTextValue(reader)).toBe("base+more");
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

test("listSnapshotCharOpIds reconstructs op ids from a shallow snapshot", async () => {
  const alice = await createDocument("alice-seed");
  const bob = await createDocument("bob-seed");
  const alicePeer = await derivePeerId("alice-seed");
  const bobPeer = await derivePeerId("bob-seed");

  const base = encodeVersionVector(alice);
  alice.getText("text").update("hello");
  importUpdates(bob, [exportUpdatesSince(alice, base)]);
  bob.getText("text").insert(2, "XY");
  bob.commit();

  // A persisted shallow snapshot trims history but keeps current state, so reading
  // blame off a rebuilt doc must match reading it off the live doc — including the
  // original per-peer authorship of every surviving character.
  const snapshot = exportShallowSnapshot(bob);
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

  const snapshot = exportShallowSnapshot(bob);
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

  // Reads identically off a rebuilt shallow snapshot as off the live doc.
  expect(
    listSnapshotFieldEditors(exportShallowSnapshot(bob), "fields"),
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
    listSnapshotFieldEditors(exportShallowSnapshot(doc), "fields"),
  ).toEqual([]);
});
