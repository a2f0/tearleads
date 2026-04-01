import { afterAll, expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument as createLoroDocument,
  decryptLoroUpdate,
  encodeVersionVector,
  encryptLoroUpdate,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import { createLargeText } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { db } from "../../src/adapters/postgres";
import { del } from "../../src/adapters/redis";
import { documentUpdates } from "../../src/schema";
import { createDocument, syncDocument } from "../helpers/api";
import { authenticate } from "../helpers/authenticate";
import { createTestUser } from "../helpers/createTestUser";
import { grantDocumentWriteAccessToUser } from "../helpers/grantDocumentAccess";
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

test("Alice and Bob converge through encrypted Loro update streaming", async () => {
  const createDocumentResponse = await createDocument(alice.token);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  documentId = createdDocument.id;
  expect(typeof documentId).toBe("string");
  expect(createdDocument.currentAccessEpoch).toBe(1);
  expect(createdDocument.recipientEncapsulationPublicKeys).toHaveLength(1);

  const aliceDoc = await createLoroDocument(alice.fingerprint);
  const bobDoc = await createLoroDocument(bob.fingerprint);

  const bobForbiddenFetchResponse = await syncDocument(
    documentId,
    {
      accessEpoch: 1,
      localVersionVector: encodeVersionVector(bobDoc),
      outgoingUpdates: [],
    },
    bob.token,
  );
  expect(bobForbiddenFetchResponse.status).toBe(403);

  const grantedAccessEpoch = await grantDocumentWriteAccessToUser(
    documentId,
    bob.userId,
  );
  expect(grantedAccessEpoch).toBe(2);

  const aliceVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("Hello from Alice");
  const firstUpdate = exportUpdatesSince(aliceDoc, aliceVersion);
  const encryptedFirstUpdate = await encryptLoroUpdate(
    firstUpdate,
    createdDocument.recipientEncapsulationPublicKeys.map((publicKey: string) =>
      base64ToBytes(publicKey),
    ),
  );
  const firstUpdateVersionVectors = getUpdateVersionVectors(firstUpdate);

  const appendFirstResponse = await syncDocument(
    documentId,
    {
      accessEpoch: 1,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: encryptedFirstUpdate,
          partialStartVersionVector:
            firstUpdateVersionVectors.partialStartVersionVector,
          partialEndVersionVector:
            firstUpdateVersionVectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(appendFirstResponse.status).toBe(200);
  const staleEpochSync = await appendFirstResponse.json();
  expect(staleEpochSync.acceptedOutgoingUpdateIds).toHaveLength(0);
  expect(staleEpochSync.currentAccessEpoch).toBe(grantedAccessEpoch);
  expect(staleEpochSync.recipientEncapsulationPublicKeys).toHaveLength(2);

  const encryptedGrantedUpdate = await encryptLoroUpdate(
    firstUpdate,
    staleEpochSync.recipientEncapsulationPublicKeys.map((publicKey: string) =>
      base64ToBytes(publicKey),
    ),
  );

  const appendGrantedResponse = await syncDocument(
    documentId,
    {
      accessEpoch: grantedAccessEpoch,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: encryptedGrantedUpdate,
          partialStartVersionVector:
            firstUpdateVersionVectors.partialStartVersionVector,
          partialEndVersionVector:
            firstUpdateVersionVectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(appendGrantedResponse.status).toBe(200);
  const appendedFirstUpdate = await appendGrantedResponse.json();
  expect(appendedFirstUpdate.acceptedOutgoingUpdateIds).toHaveLength(1);
  expect(appendedFirstUpdate.currentAccessEpoch).toBe(grantedAccessEpoch);

  const bobFetchResponse = await syncDocument(
    documentId,
    {
      accessEpoch: grantedAccessEpoch,
      localVersionVector: encodeVersionVector(bobDoc),
      outgoingUpdates: [],
    },
    bob.token,
  );
  expect(bobFetchResponse.status).toBe(200);
  const bobFetched = await bobFetchResponse.json();
  expect(bobFetched.updates.length).toBe(1);
  expect(bobFetched.currentAccessEpoch).toBe(grantedAccessEpoch);
  expect(bobFetched.recipientEncapsulationPublicKeys).toHaveLength(2);

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
  const encryptedSecondUpdate = await encryptLoroUpdate(
    secondUpdate,
    bobFetched.recipientEncapsulationPublicKeys.map((publicKey: string) =>
      base64ToBytes(publicKey),
    ),
  );
  const secondUpdateVersionVectors = getUpdateVersionVectors(secondUpdate);

  const appendSecondResponse = await syncDocument(
    documentId,
    {
      accessEpoch: grantedAccessEpoch,
      localVersionVector: encodeVersionVector(bobDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: encryptedSecondUpdate,
          partialStartVersionVector:
            secondUpdateVersionVectors.partialStartVersionVector,
          partialEndVersionVector:
            secondUpdateVersionVectors.partialEndVersionVector,
        },
      ],
    },
    bob.token,
  );
  expect(appendSecondResponse.status).toBe(200);
  const appendedSecondUpdate = await appendSecondResponse.json();
  expect(appendedSecondUpdate.acceptedOutgoingUpdateIds).toHaveLength(1);
  expect(appendedSecondUpdate.currentAccessEpoch).toBe(grantedAccessEpoch);

  const aliceFetchResponse = await syncDocument(
    documentId,
    {
      accessEpoch: grantedAccessEpoch,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [],
    },
    alice.token,
  );
  expect(aliceFetchResponse.status).toBe(200);
  const aliceFetched = await aliceFetchResponse.json();
  expect(aliceFetched.updates.length).toBe(1);
  expect(aliceFetched.currentAccessEpoch).toBe(grantedAccessEpoch);

  const decryptedForAlice = await Promise.all(
    aliceFetched.updates.map((update: { encryptedData: string }) =>
      decryptLoroUpdate(update.encryptedData, alice.kem.secretKey),
    ),
  );
  importUpdates(aliceDoc, decryptedForAlice);
  expect(getTextValue(aliceDoc)).toBe("Hello from Alice and Bob");

  const bobNoopFetchResponse = await syncDocument(
    documentId,
    {
      accessEpoch: grantedAccessEpoch,
      localVersionVector: encodeVersionVector(bobDoc),
      outgoingUpdates: [],
    },
    bob.token,
  );
  expect(bobNoopFetchResponse.status).toBe(200);
  const bobNoopFetched = await bobNoopFetchResponse.json();
  expect(bobNoopFetched.updates.length).toBe(0);
});

test("Large note-style updates stay as a single synced document update", async () => {
  const createDocumentResponse = await createDocument(alice.token);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();

  const aliceDoc = await createLoroDocument(alice.fingerprint);
  const initialVersion = encodeVersionVector(aliceDoc);
  const largeText = createLargeText(1024 * 1024);
  aliceDoc.getText("text").update(largeText);

  const largeUpdate = exportUpdatesSince(aliceDoc, initialVersion);
  expect(largeUpdate.byteLength).toBeGreaterThan(256 * 1024);

  const encryptedLargeUpdate = await encryptLoroUpdate(
    largeUpdate,
    createdDocument.recipientEncapsulationPublicKeys.map((publicKey: string) =>
      base64ToBytes(publicKey),
    ),
  );
  const largeUpdateVersionVectors = getUpdateVersionVectors(largeUpdate);

  const syncResponse = await syncDocument(
    createdDocument.id,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: encryptedLargeUpdate,
          partialStartVersionVector:
            largeUpdateVersionVectors.partialStartVersionVector,
          partialEndVersionVector:
            largeUpdateVersionVectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(syncResponse.status).toBe(200);
  const synced = await syncResponse.json();
  expect(synced.acceptedOutgoingUpdateIds).toHaveLength(1);

  const storedUpdates = await db
    .select()
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, createdDocument.id));

  expect(storedUpdates).toHaveLength(1);
  expect(storedUpdates[0]?.encryptedData.length).toBeGreaterThan(256 * 1024);
});
