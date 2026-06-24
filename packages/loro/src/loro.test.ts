import { expect, test } from "bun:test";
import {
  createDocument,
  derivePeerId,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
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
