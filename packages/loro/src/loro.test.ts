import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import {
  createDocument,
  decryptLoroUpdate,
  encodeVersionVector,
  encryptLoroUpdate,
  exportUpdatesSince,
  getTextValue,
  importUpdates,
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
