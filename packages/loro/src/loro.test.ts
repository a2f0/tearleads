import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import {
  createDocument,
  decryptLoroUpdate,
  derivePeerId,
  encodeVersionVector,
  encryptLoroUpdate,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
  listVersionVectorSpans,
} from "./index";

test("encrypted loro updates let peers converge on the same text", async () => {
  const aliceSigning = generateSigningSeedAndKeyPair();
  const bobSigning = generateSigningSeedAndKeyPair();
  const documentKey = crypto.getRandomValues(new Uint8Array(32));

  const aliceDoc = await createDocument(aliceSigning.signingPublicKey);
  const bobDoc = await createDocument(bobSigning.signingPublicKey);

  const initialVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("hello");
  const aliceUpdate = exportUpdatesSince(aliceDoc, initialVersion);
  const encryptedAliceUpdate = await encryptLoroUpdate(
    aliceUpdate,
    1,
    documentKey,
  );
  const decryptedForBob = await decryptLoroUpdate(
    encryptedAliceUpdate,
    1,
    documentKey,
  );
  importUpdates(bobDoc, [decryptedForBob]);
  expect(getTextValue(bobDoc)).toBe("hello");

  const bobVersion = encodeVersionVector(bobDoc);
  bobDoc.getText("text").update("hello world");
  const bobUpdate = exportUpdatesSince(bobDoc, bobVersion);
  const encryptedBobUpdate = await encryptLoroUpdate(bobUpdate, 1, documentKey);
  const decryptedForAlice = await decryptLoroUpdate(
    encryptedBobUpdate,
    1,
    documentKey,
  );
  importUpdates(aliceDoc, [decryptedForAlice]);
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
