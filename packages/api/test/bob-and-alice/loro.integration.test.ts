import { afterAll, expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createTextDocument,
  decryptLoroUpdate,
  encodeVersionVector,
  encryptLoroUpdate,
  exportUpdatesSince,
  getTextValue,
  importUpdates,
} from "@tearleads/loro";
import { del } from "../../src/adapters/redis";
import {
  appendDocumentUpdate,
  createDocument,
  fetchEncapsulationKey,
  getDocumentUpdates,
} from "../helpers/api";
import { authenticate } from "../helpers/authenticate";
import { createTestUser } from "../helpers/createTestUser";
import { registerUser } from "../helpers/registerUser";

const alice = createTestUser();
const bob = createTestUser();

afterAll(async () => {
  await del(alice.fingerprint);
  await del(bob.fingerprint);
});

test("Alice registers", async () => {
  const challenge = await registerUser(alice);
  expect(typeof challenge).toBe("string");
});

test("Bob registers", async () => {
  const challenge = await registerUser(bob);
  expect(typeof challenge).toBe("string");
});

test("Alice authenticates", async () => {
  await authenticate(alice);
  expect(alice.token.length).toBeGreaterThan(0);
});

test("Bob authenticates", async () => {
  await authenticate(bob);
  expect(bob.token.length).toBeGreaterThan(0);
});

let documentId = "";
let aliceCursor = 0;
let bobCursor = 0;

test("Alice and Bob converge through encrypted Loro update streaming", async () => {
  const createDocumentResponse = await createDocument(alice.token);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  documentId = createdDocument.id;
  expect(typeof documentId).toBe("string");

  const bobKeyResponse = await fetchEncapsulationKey(bob.userId, alice.token);
  expect(bobKeyResponse.status).toBe(200);
  const bobKeyBody = await bobKeyResponse.json();
  const bobPublicKey = base64ToBytes(bobKeyBody.encapsulationPublicKey);

  const aliceKeyResponse = await fetchEncapsulationKey(alice.userId, bob.token);
  expect(aliceKeyResponse.status).toBe(200);
  const aliceKeyBody = await aliceKeyResponse.json();
  const alicePublicKey = base64ToBytes(aliceKeyBody.encapsulationPublicKey);

  const aliceDoc = await createTextDocument(alice.fingerprint);
  const bobDoc = await createTextDocument(bob.fingerprint);

  const aliceVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("Hello from Alice");
  const firstUpdate = exportUpdatesSince(aliceDoc, aliceVersion);
  const encryptedFirstUpdate = await encryptLoroUpdate(firstUpdate, [
    alicePublicKey,
    bobPublicKey,
  ]);

  const appendFirstResponse = await appendDocumentUpdate(
    documentId,
    encryptedFirstUpdate,
    alice.token,
  );
  expect(appendFirstResponse.status).toBe(200);
  const appendedFirstUpdate = await appendFirstResponse.json();
  aliceCursor = appendedFirstUpdate.sequence;
  expect(aliceCursor).toBeGreaterThan(0);

  const bobFetchResponse = await getDocumentUpdates(documentId, bob.token);
  expect(bobFetchResponse.status).toBe(200);
  const bobFetched = await bobFetchResponse.json();
  expect(bobFetched.updates.length).toBe(1);
  bobCursor = bobFetched.nextCursor;

  const decryptedForBob = await Promise.all(
    bobFetched.updates.map((update: { encryptedData: string }) =>
      decryptLoroUpdate(update.encryptedData, bob.kem.secretKey),
    ),
  );
  importUpdates(bobDoc, decryptedForBob);
  expect(getTextValue(bobDoc)).toBe("Hello from Alice");

  const bobVersion = encodeVersionVector(bobDoc);
  bobDoc.getText("text").update("Hello from Alice and Bob");
  const secondUpdate = exportUpdatesSince(bobDoc, bobVersion);
  const encryptedSecondUpdate = await encryptLoroUpdate(secondUpdate, [
    alicePublicKey,
    bobPublicKey,
  ]);

  const appendSecondResponse = await appendDocumentUpdate(
    documentId,
    encryptedSecondUpdate,
    bob.token,
  );
  expect(appendSecondResponse.status).toBe(200);

  const aliceFetchResponse = await getDocumentUpdates(
    documentId,
    alice.token,
    aliceCursor,
  );
  expect(aliceFetchResponse.status).toBe(200);
  const aliceFetched = await aliceFetchResponse.json();
  expect(aliceFetched.updates.length).toBe(1);
  aliceCursor = aliceFetched.nextCursor;

  const decryptedForAlice = await Promise.all(
    aliceFetched.updates.map((update: { encryptedData: string }) =>
      decryptLoroUpdate(update.encryptedData, alice.kem.secretKey),
    ),
  );
  importUpdates(aliceDoc, decryptedForAlice);
  expect(getTextValue(aliceDoc)).toBe("Hello from Alice and Bob");

  const bobNoopFetchResponse = await getDocumentUpdates(
    documentId,
    bob.token,
    bobCursor,
  );
  expect(bobNoopFetchResponse.status).toBe(200);
  const bobNoopFetched = await bobNoopFetchResponse.json();
  expect(bobNoopFetched.updates.length).toBe(1);
});
