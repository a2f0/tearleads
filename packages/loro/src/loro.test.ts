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
