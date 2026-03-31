import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
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
  const aliceKem = generateKemSeedAndKeyPair();
  const bobSigning = generateSigningSeedAndKeyPair();
  const bobKem = generateKemSeedAndKeyPair();

  const aliceDoc = await createDocument(aliceSigning.signingPublicKey);
  const bobDoc = await createDocument(bobSigning.signingPublicKey);
  const recipients = [aliceKem.publicKey, bobKem.publicKey];

  const initialVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("hello");
  const aliceUpdate = exportUpdatesSince(aliceDoc, initialVersion);
  const encryptedAliceUpdate = await encryptLoroUpdate(aliceUpdate, recipients);
  const decryptedForBob = await decryptLoroUpdate(
    encryptedAliceUpdate,
    bobKem.secretKey,
  );
  importUpdates(bobDoc, [decryptedForBob]);
  expect(getTextValue(bobDoc)).toBe("hello");

  const bobVersion = encodeVersionVector(bobDoc);
  bobDoc.getText("text").update("hello world");
  const bobUpdate = exportUpdatesSince(bobDoc, bobVersion);
  const encryptedBobUpdate = await encryptLoroUpdate(bobUpdate, recipients);
  const decryptedForAlice = await decryptLoroUpdate(
    encryptedBobUpdate,
    aliceKem.secretKey,
  );
  importUpdates(aliceDoc, [decryptedForAlice]);
  expect(getTextValue(aliceDoc)).toBe("hello world");
});
