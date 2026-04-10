import { afterAll, expect, test } from "bun:test";
import {
  decryptAsRecipient,
  encryptForRecipients,
  parseBlobEnvelope,
  serializeBlobEnvelope,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
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
import { and, eq } from "drizzle-orm";
import { refreshContainerAccessSubtree } from "../../src/access/containerAccess";
import { db } from "../../src/adapters/postgres";
import { del } from "../../src/adapters/redis";
import { app } from "../../src/index";
import { documentUpdates, objectAccessGrants } from "../../src/schema";
import {
  commitDocumentChange,
  createDocument,
  stageBlob,
  syncDocument,
} from "../helpers/api";
import { authenticate } from "../helpers/authenticate";
import { createTestUser } from "../helpers/createTestUser";
import { grantRootContainerWriteAccessToUser } from "../helpers/grantContainerAccess";
import { registerUser } from "../helpers/registerUser";

const alice = createTestUser();
const bob = createTestUser();

type TestDocumentRecipientEnvelope = {
  keyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
};

async function createStagedBlobInput(encryptedBytes: string): Promise<{
  encryptedBytes: string;
  byteLength: number;
  sha256: string;
}> {
  const encodedBytes = new TextEncoder().encode(encryptedBytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encodedBytes),
  );

  return {
    encryptedBytes,
    byteLength: encodedBytes.byteLength,
    sha256: Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  };
}

async function createDocumentEncryption(
  encodedRecipientPublicKeys: string[],
  existingDocumentKey?: Uint8Array,
): Promise<{
  documentKey: Uint8Array;
  documentRecipientEnvelopes: TestDocumentRecipientEnvelope[];
}> {
  const documentKey =
    existingDocumentKey ?? crypto.getRandomValues(new Uint8Array(32));
  const wrappedRecipients = await wrapDekForRecipients(
    documentKey,
    encodedRecipientPublicKeys.map((publicKey) => base64ToBytes(publicKey)),
  );

  return {
    documentKey,
    documentRecipientEnvelopes: wrappedRecipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
    })),
  };
}

async function unwrapDocumentKeyFromEnvelopes(
  documentRecipientEnvelopes: TestDocumentRecipientEnvelope[] | null,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  if (!documentRecipientEnvelopes) {
    throw new Error("Missing document recipient envelopes");
  }

  return unwrapDek(
    documentRecipientEnvelopes.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: base64ToBytes(recipient.kemCipherText),
      wrappedKey: base64ToBytes(recipient.wrappedKey),
    })),
    secretKey,
  );
}

async function resolveDocumentEncryptionForSync(input: {
  documentRecipientEnvelopes: TestDocumentRecipientEnvelope[] | null;
  fallbackDocumentKey: Uint8Array;
  recipientEncapsulationPublicKeys: string[];
  secretKey: Uint8Array;
}): Promise<{
  documentKey: Uint8Array;
  documentRecipientEnvelopes: TestDocumentRecipientEnvelope[];
}> {
  if (input.documentRecipientEnvelopes) {
    return {
      documentKey: await unwrapDocumentKeyFromEnvelopes(
        input.documentRecipientEnvelopes,
        input.secretKey,
      ),
      documentRecipientEnvelopes: input.documentRecipientEnvelopes,
    };
  }

  return createDocumentEncryption(
    input.recipientEncapsulationPublicKeys,
    input.fallbackDocumentKey,
  );
}

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
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  documentId = createdDocument.id;
  expect(typeof documentId).toBe("string");
  expect(createdDocument.currentAccessEpoch).toBe(1);
  expect(createdDocument.recipientEncapsulationPublicKeys).toHaveLength(1);
  expect(createdDocument.documentRecipientEnvelopes).toHaveLength(1);
  const initialDocumentKey = await unwrapDocumentKeyFromEnvelopes(
    createdDocument.documentRecipientEnvelopes,
    alice.kem.secretKey,
  );

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

  const grantedAccessEpoch = await grantRootContainerWriteAccessToUser(
    alice.userId,
    bob.userId,
  );
  expect(grantedAccessEpoch).toBe(2);

  const aliceVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("Hello from Alice");
  const firstUpdate = exportUpdatesSince(aliceDoc, aliceVersion);
  const encryptedFirstUpdate = await encryptLoroUpdate(
    firstUpdate,
    createdDocument.currentAccessEpoch,
    initialDocumentKey,
  );
  const firstUpdateVersionVectors = getUpdateVersionVectors(firstUpdate);

  const appendFirstResponse = await syncDocument(
    documentId,
    {
      accessEpoch: 1,
      documentRecipientEnvelopes: createdDocument.documentRecipientEnvelopes,
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
  const grantedDocumentEncryption = await resolveDocumentEncryptionForSync({
    documentRecipientEnvelopes: staleEpochSync.documentRecipientEnvelopes,
    fallbackDocumentKey: initialDocumentKey,
    recipientEncapsulationPublicKeys:
      staleEpochSync.recipientEncapsulationPublicKeys,
    secretKey: alice.kem.secretKey,
  });

  const encryptedGrantedUpdate = await encryptLoroUpdate(
    firstUpdate,
    grantedAccessEpoch,
    grantedDocumentEncryption.documentKey,
  );

  const appendGrantedResponse = await syncDocument(
    documentId,
    {
      accessEpoch: grantedAccessEpoch,
      documentRecipientEnvelopes:
        grantedDocumentEncryption.documentRecipientEnvelopes,
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
  expect(bobFetched.missingUpdateEpochs).toEqual(["current_epoch"]);
  expect(bobFetched.updates).toEqual(
    expect.arrayContaining([expect.objectContaining({ accessEpoch: 2 })]),
  );
  expect(bobFetched.currentAccessEpoch).toBe(grantedAccessEpoch);
  expect(bobFetched.recipientEncapsulationPublicKeys).toHaveLength(2);
  const bobDocumentKey = await unwrapDocumentKeyFromEnvelopes(
    bobFetched.documentRecipientEnvelopes,
    bob.kem.secretKey,
  );

  const decryptedForBob = await Promise.all(
    bobFetched.updates.map((update: { encryptedData: string }) =>
      decryptLoroUpdate(
        update.encryptedData,
        bobFetched.currentAccessEpoch,
        bobDocumentKey,
      ),
    ),
  );
  importUpdates(bobDoc, decryptedForBob);
  expect(getTextValue(bobDoc)).toBe("Hello from Alice");

  const bobVersion = encodeVersionVector(bobDoc);
  bobDoc.getText("text").update("Hello from Alice and Bob");
  const secondUpdate = exportUpdatesSince(bobDoc, bobVersion);
  const encryptedSecondUpdate = await encryptLoroUpdate(
    secondUpdate,
    grantedAccessEpoch,
    bobDocumentKey,
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
  const aliceDocumentKey = await unwrapDocumentKeyFromEnvelopes(
    aliceFetched.documentRecipientEnvelopes,
    alice.kem.secretKey,
  );

  const decryptedForAlice = await Promise.all(
    aliceFetched.updates.map((update: { encryptedData: string }) =>
      decryptLoroUpdate(
        update.encryptedData,
        aliceFetched.currentAccessEpoch,
        aliceDocumentKey,
      ),
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
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentEncryption = {
    documentKey: await unwrapDocumentKeyFromEnvelopes(
      createdDocument.documentRecipientEnvelopes,
      alice.kem.secretKey,
    ),
    documentRecipientEnvelopes: createdDocument.documentRecipientEnvelopes,
  };

  const aliceDoc = await createLoroDocument(alice.fingerprint);
  const initialVersion = encodeVersionVector(aliceDoc);
  const largeText = createLargeText(1024 * 1024);
  aliceDoc.getText("text").update(largeText);

  const largeUpdate = exportUpdatesSince(aliceDoc, initialVersion);
  expect(largeUpdate.byteLength).toBeGreaterThan(256 * 1024);

  const encryptedLargeUpdate = await encryptLoroUpdate(
    largeUpdate,
    createdDocument.currentAccessEpoch,
    documentEncryption.documentKey,
  );
  const largeUpdateVersionVectors = getUpdateVersionVectors(largeUpdate);

  const syncResponse = await syncDocument(
    createdDocument.id,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      documentRecipientEnvelopes: documentEncryption.documentRecipientEnvelopes,
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

test("Document sync returns the canonical bundle after a divergent current-epoch bundle", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const canonicalDocumentEncryption = {
    documentKey: await unwrapDocumentKeyFromEnvelopes(
      createdDocument.documentRecipientEnvelopes,
      alice.kem.secretKey,
    ),
    documentRecipientEnvelopes:
      createdDocument.documentRecipientEnvelopes as TestDocumentRecipientEnvelope[],
  };
  const divergentDocumentEncryption = await createDocumentEncryption(
    createdDocument.recipientEncapsulationPublicKeys,
  );

  const aliceDoc = await createLoroDocument(alice.fingerprint);
  const initialVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("canonical retry after bundle conflict");
  const update = exportUpdatesSince(aliceDoc, initialVersion);
  const vectors = getUpdateVersionVectors(update);
  const updateId = crypto.randomUUID();

  const divergentSyncResponse = await syncDocument(
    createdDocument.id,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      documentRecipientEnvelopes:
        divergentDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: updateId,
          encryptedData: await encryptLoroUpdate(
            update,
            createdDocument.currentAccessEpoch,
            divergentDocumentEncryption.documentKey,
          ),
          partialStartVersionVector: vectors.partialStartVersionVector,
          partialEndVersionVector: vectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(divergentSyncResponse.status).toBe(200);
  const divergentSync = await divergentSyncResponse.json();
  expect(divergentSync.acceptedOutgoingUpdateIds).toEqual([]);
  expect(divergentSync.canonicalDocumentRecipientEnvelopesAdopted).toBe(true);
  expect(divergentSync.missingUpdateEpochs).toEqual([]);
  expect(divergentSync.documentRecipientEnvelopes).toEqual(
    canonicalDocumentEncryption.documentRecipientEnvelopes,
  );

  const canonicalSyncResponse = await syncDocument(
    createdDocument.id,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      documentRecipientEnvelopes:
        canonicalDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: updateId,
          encryptedData: await encryptLoroUpdate(
            update,
            createdDocument.currentAccessEpoch,
            canonicalDocumentEncryption.documentKey,
          ),
          partialStartVersionVector: vectors.partialStartVersionVector,
          partialEndVersionVector: vectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(canonicalSyncResponse.status).toBe(200);
  const canonicalSync = await canonicalSyncResponse.json();
  expect(canonicalSync.acceptedOutgoingUpdateIds).toEqual([updateId]);
  expect(canonicalSync.canonicalDocumentRecipientEnvelopesAdopted).toBe(false);
  expect(canonicalSync.documentRecipientEnvelopes).toEqual(
    canonicalDocumentEncryption.documentRecipientEnvelopes,
  );

  const reversedCanonicalEnvelopes = [
    ...canonicalDocumentEncryption.documentRecipientEnvelopes,
  ].reverse();
  expect(
    reversedCanonicalEnvelopes.map((envelope) => envelope.keyFingerprint),
  ).not.toEqual(
    canonicalDocumentEncryption.documentRecipientEnvelopes.map(
      (envelope) => envelope.keyFingerprint,
    ),
  );

  const reorderedRetryResponse = await syncDocument(
    createdDocument.id,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      documentRecipientEnvelopes: reversedCanonicalEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [],
    },
    alice.token,
  );
  expect(reorderedRetryResponse.status).toBe(200);
  const reorderedRetry = await reorderedRetryResponse.json();
  expect(reorderedRetry.acceptedOutgoingUpdateIds).toEqual([]);
  expect(reorderedRetry.canonicalDocumentRecipientEnvelopesAdopted).toBe(false);
  expect(reorderedRetry.documentRecipientEnvelopes).toEqual(
    canonicalDocumentEncryption.documentRecipientEnvelopes,
  );
});

test("Bob can read a rebaselined note after share and decrypt a correctly wrapped attachment blob", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const sharedDocumentId = String(createdDocument.id ?? "");
  const initialDocumentEncryption = {
    documentKey: await unwrapDocumentKeyFromEnvelopes(
      createdDocument.documentRecipientEnvelopes,
      alice.kem.secretKey,
    ),
    documentRecipientEnvelopes: createdDocument.documentRecipientEnvelopes,
  };

  const aliceDoc = await createLoroDocument(alice.fingerprint);
  const initialVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("note created before share");
  const initialUpdate = exportUpdatesSince(aliceDoc, initialVersion);
  const initialEncryptedUpdate = await encryptLoroUpdate(
    initialUpdate,
    createdDocument.currentAccessEpoch,
    initialDocumentEncryption.documentKey,
  );
  const initialVectors = getUpdateVersionVectors(initialUpdate);

  const initialSyncResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      documentRecipientEnvelopes:
        initialDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: initialEncryptedUpdate,
          partialStartVersionVector: initialVectors.partialStartVersionVector,
          partialEndVersionVector: initialVectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(initialSyncResponse.status).toBe(200);

  const grantedAccessEpoch = await grantRootContainerWriteAccessToUser(
    alice.userId,
    bob.userId,
  );
  expect(grantedAccessEpoch).toBe(2);

  const staleEpochResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [],
    },
    alice.token,
  );
  expect(staleEpochResponse.status).toBe(200);
  const staleEpochSync = await staleEpochResponse.json();
  expect(staleEpochSync.currentAccessEpoch).toBe(grantedAccessEpoch);
  expect(staleEpochSync.recipientEncapsulationPublicKeys).toHaveLength(2);
  const rebasedDocumentEncryption = await resolveDocumentEncryptionForSync({
    documentRecipientEnvelopes: staleEpochSync.documentRecipientEnvelopes,
    fallbackDocumentKey: initialDocumentEncryption.documentKey,
    recipientEncapsulationPublicKeys:
      staleEpochSync.recipientEncapsulationPublicKeys,
    secretKey: alice.kem.secretKey,
  });

  const rebasedEncryptedUpdate = await encryptLoroUpdate(
    initialUpdate,
    grantedAccessEpoch,
    rebasedDocumentEncryption.documentKey,
  );
  const rebasedVectors = getUpdateVersionVectors(initialUpdate);

  const rebasedSyncResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: grantedAccessEpoch,
      documentRecipientEnvelopes:
        rebasedDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: rebasedEncryptedUpdate,
          partialStartVersionVector: rebasedVectors.partialStartVersionVector,
          partialEndVersionVector: rebasedVectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(rebasedSyncResponse.status).toBe(200);

  const sharedBlobEnvelope = await encryptForRecipients(
    new TextEncoder().encode("drivers-license-front-image"),
    staleEpochSync.recipientEncapsulationPublicKeys.map((publicKey: string) =>
      base64ToBytes(publicKey),
    ),
  );
  const serializedSharedBlobEnvelope =
    serializeBlobEnvelope(sharedBlobEnvelope);
  const stageResponse = await stageBlob(
    await createStagedBlobInput(serializedSharedBlobEnvelope),
    alice.token,
  );
  expect(stageResponse.status).toBe(200);
  const stagedBlob = await stageResponse.json();

  const attachResponse = await commitDocumentChange(
    sharedDocumentId,
    {
      accessEpoch: grantedAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_front",
          stageId: stagedBlob.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(attachResponse.status).toBe(200);
  const attached = await attachResponse.json();
  const blobId = String(attached.committedBindings[0]?.blobId ?? "");
  expect(blobId.length).toBeGreaterThan(0);

  const bobDoc = await createLoroDocument(bob.fingerprint);
  const bobSyncResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: grantedAccessEpoch,
      localVersionVector: encodeVersionVector(bobDoc),
      outgoingUpdates: [],
    },
    bob.token,
  );
  expect(bobSyncResponse.status).toBe(200);
  const bobFetched = await bobSyncResponse.json();
  const bobDocumentKey = await unwrapDocumentKeyFromEnvelopes(
    bobFetched.documentRecipientEnvelopes,
    bob.kem.secretKey,
  );
  const decryptedForBob = (
    await Promise.all(
      bobFetched.updates.map(async (update: { encryptedData: string }) => {
        try {
          return await decryptLoroUpdate(
            update.encryptedData,
            bobFetched.currentAccessEpoch,
            bobDocumentKey,
          );
        } catch {
          return null;
        }
      }),
    )
  ).filter((update): update is Uint8Array => update !== null);
  importUpdates(bobDoc, decryptedForBob);
  expect(getTextValue(bobDoc)).toBe("note created before share");

  const bobAttachmentsResponse = await app.request(
    `/documents/${sharedDocumentId}/attachments`,
    {
      headers: {
        Authorization: `Bearer ${bob.token}`,
      },
      method: "GET",
    },
  );
  expect(bobAttachmentsResponse.status).toBe(200);
  const bobAttachments = await bobAttachmentsResponse.json();
  expect(bobAttachments).toHaveLength(1);
  expect(bobAttachments[0]?.blobId).toBe(blobId);
  expect(bobAttachments[0]?.slotId).toBe("slot_front");
  expect(typeof bobAttachments[0]?.bindingId).toBe("string");

  const bobBlobResponse = await app.request(`/blobs/${blobId}`, {
    headers: {
      Authorization: `Bearer ${bob.token}`,
    },
    method: "GET",
  });
  expect(bobBlobResponse.status).toBe(200);
  const bobBlob = await bobBlobResponse.json();

  expect(
    await decryptAsRecipient(
      parseBlobEnvelope(bobBlob.encryptedBytes),
      bob.kem.secretKey,
    ),
  ).toEqual(new TextEncoder().encode("drivers-license-front-image"));
});

test("Bob can discover and read a note after Alice shares its container through the HTTP share route", async () => {
  const sharedContainerId = crypto.randomUUID();
  const createContainerResponse = await app.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${alice.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: sharedContainerId,
      initialMetadataUpdates: [],
      parentId: alice.rootContainerId,
    }),
  });
  expect(createContainerResponse.status).toBe(200);

  const createDocumentResponse = await createDocument(alice.token, [
    sharedContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const sharedDocumentId = String(createdDocument.id ?? "");
  const initialDocumentEncryption = {
    documentKey: await unwrapDocumentKeyFromEnvelopes(
      createdDocument.documentRecipientEnvelopes,
      alice.kem.secretKey,
    ),
    documentRecipientEnvelopes: createdDocument.documentRecipientEnvelopes,
  };

  const aliceDoc = await createLoroDocument(alice.fingerprint);
  const initialVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("shared through http route");
  const initialUpdate = exportUpdatesSince(aliceDoc, initialVersion);
  const initialEncryptedUpdate = await encryptLoroUpdate(
    initialUpdate,
    createdDocument.currentAccessEpoch,
    initialDocumentEncryption.documentKey,
  );
  const initialVectors = getUpdateVersionVectors(initialUpdate);

  const initialSyncResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      documentRecipientEnvelopes:
        initialDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: initialEncryptedUpdate,
          partialStartVersionVector: initialVectors.partialStartVersionVector,
          partialEndVersionVector: initialVectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(initialSyncResponse.status).toBe(200);

  const shareResponse = await app.request(
    `/containers/${sharedContainerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accessLevel: "write",
        subjectId: bob.userId,
        subjectType: "user",
      }),
    },
  );
  expect(shareResponse.status).toBe(200);
  const shared = await shareResponse.json();
  expect(shared.id).toBe(sharedContainerId);
  expect(shared.metadataAccessEpoch).toBe(2);
  expect(shared.metadataRecipientEncapsulationPublicKeys).toHaveLength(2);

  const staleEpochResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [],
    },
    alice.token,
  );
  expect(staleEpochResponse.status).toBe(200);
  const staleEpochSync = await staleEpochResponse.json();
  expect(staleEpochSync.currentAccessEpoch).toBe(2);
  expect(staleEpochSync.documentRecipientEnvelopeAction).toBe("rewrap");
  expect(staleEpochSync.recipientEncapsulationPublicKeys).toHaveLength(2);
  const bobCurrentEpochNoopResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: staleEpochSync.currentAccessEpoch,
      localVersionVector: "AA==",
      outgoingUpdates: [],
    },
    bob.token,
  );
  expect(bobCurrentEpochNoopResponse.status).toBe(200);
  const bobCurrentEpochNoopSync = await bobCurrentEpochNoopResponse.json();
  expect(bobCurrentEpochNoopSync.currentAccessEpoch).toBe(2);
  expect(bobCurrentEpochNoopSync.documentRecipientEnvelopeAction).toBe(
    "rewrap",
  );
  expect(bobCurrentEpochNoopSync.documentRecipientEnvelopes).toBeNull();
  const rebasedDocumentEncryption = await resolveDocumentEncryptionForSync({
    documentRecipientEnvelopes: staleEpochSync.documentRecipientEnvelopes,
    fallbackDocumentKey: initialDocumentEncryption.documentKey,
    recipientEncapsulationPublicKeys:
      staleEpochSync.recipientEncapsulationPublicKeys,
    secretKey: alice.kem.secretKey,
  });

  const rebasedEncryptedUpdate = await encryptLoroUpdate(
    initialUpdate,
    staleEpochSync.currentAccessEpoch,
    rebasedDocumentEncryption.documentKey,
  );
  const rebasedSyncResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: staleEpochSync.currentAccessEpoch,
      documentRecipientEnvelopes:
        rebasedDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: rebasedEncryptedUpdate,
          partialStartVersionVector: initialVectors.partialStartVersionVector,
          partialEndVersionVector: initialVectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(rebasedSyncResponse.status).toBe(200);

  const bobContainersResponse = await app.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bob.token}`,
    },
  });
  expect(bobContainersResponse.status).toBe(200);
  const bobContainers = await bobContainersResponse.json();
  expect(bobContainers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: sharedContainerId,
        metadataAccessEpoch: 2,
        metadataDocumentId: shared.metadataDocumentId,
      }),
    ]),
  );

  const bobDocumentsResponse = await app.request(
    `/containers/${sharedContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bob.token}`,
      },
    },
  );
  expect(bobDocumentsResponse.status).toBe(200);
  const bobDocuments = await bobDocumentsResponse.json();
  expect(bobDocuments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        currentAccessEpoch: 2,
        id: sharedDocumentId,
        linkedContainerIds: [sharedContainerId],
      }),
    ]),
  );

  const bobDoc = await createLoroDocument(bob.fingerprint);
  const bobSyncResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: 2,
      localVersionVector: encodeVersionVector(bobDoc),
      outgoingUpdates: [],
    },
    bob.token,
  );
  expect(bobSyncResponse.status).toBe(200);
  const bobFetched = await bobSyncResponse.json();
  const bobDocumentKey = await unwrapDocumentKeyFromEnvelopes(
    bobFetched.documentRecipientEnvelopes,
    bob.kem.secretKey,
  );
  const decryptedForBob = (
    await Promise.all(
      bobFetched.updates.map(async (update: { encryptedData: string }) => {
        try {
          return await decryptLoroUpdate(
            update.encryptedData,
            bobFetched.currentAccessEpoch,
            bobDocumentKey,
          );
        } catch {
          return null;
        }
      }),
    )
  ).filter((update): update is Uint8Array => update !== null);
  importUpdates(bobDoc, decryptedForBob);
  expect(getTextValue(bobDoc)).toBe("shared through http route");
});

test("rotate baseline sync requires the latest prior-epoch source frontier", async () => {
  const charlie = createTestUser();
  await registerUser(charlie);
  await authenticate(charlie);

  const sharedContainerId = crypto.randomUUID();
  const createContainerResponse = await app.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${alice.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: sharedContainerId,
      initialMetadataUpdates: [],
      parentId: alice.rootContainerId,
    }),
  });
  expect(createContainerResponse.status).toBe(200);

  const shareResponse = await app.request(
    `/containers/${sharedContainerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accessLevel: "write",
        subjectId: charlie.userId,
        subjectType: "user",
      }),
    },
  );
  expect(shareResponse.status).toBe(200);

  const createDocumentResponse = await createDocument(alice.token, [
    sharedContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  expect(createdDocument.currentAccessEpoch).toBe(2);
  expect(
    createdDocument.recipientEncapsulationPublicKeys.length,
  ).toBeGreaterThanOrEqual(2);
  const sharedDocumentId = String(createdDocument.id ?? "");
  const initialDocumentEncryption = {
    documentKey: await unwrapDocumentKeyFromEnvelopes(
      createdDocument.documentRecipientEnvelopes,
      alice.kem.secretKey,
    ),
    documentRecipientEnvelopes: createdDocument.documentRecipientEnvelopes,
  };

  const aliceDoc = await createLoroDocument(
    `${alice.fingerprint}-rotate-source`,
  );
  const initialVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("before recipient removal");
  const initialUpdate = exportUpdatesSince(aliceDoc, initialVersion);
  const initialVectors = getUpdateVersionVectors(initialUpdate);
  const initialEncryptedUpdate = await encryptLoroUpdate(
    initialUpdate,
    createdDocument.currentAccessEpoch,
    initialDocumentEncryption.documentKey,
  );

  const initialSyncResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      documentRecipientEnvelopes:
        initialDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: initialEncryptedUpdate,
          partialStartVersionVector: initialVectors.partialStartVersionVector,
          partialEndVersionVector: initialVectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(initialSyncResponse.status).toBe(200);

  await db
    .delete(objectAccessGrants)
    .where(
      and(
        eq(objectAccessGrants.objectType, "container"),
        eq(objectAccessGrants.objectId, sharedContainerId),
        eq(objectAccessGrants.subjectType, "user"),
        eq(objectAccessGrants.subjectId, charlie.userId),
      ),
    );
  const refreshedEpochs =
    await refreshContainerAccessSubtree(sharedContainerId);
  expect(refreshedEpochs.get(sharedContainerId)).toBe(3);

  const rotateProbeResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [],
    },
    alice.token,
  );
  expect(rotateProbeResponse.status).toBe(200);
  const rotateProbe = await rotateProbeResponse.json();
  expect(rotateProbe.currentAccessEpoch).toBe(3);
  expect(rotateProbe.documentRecipientEnvelopeAction).toBe("rotate");
  expect(rotateProbe.documentRecipientEnvelopes).toBeNull();
  expect(rotateProbe.rotateBaselineSourceVersionVector).toBe(
    initialVectors.partialEndVersionVector,
  );

  const rotatedDocumentEncryption = await createDocumentEncryption(
    rotateProbe.recipientEncapsulationPublicKeys,
  );
  const rotateBaseline = await encryptLoroUpdate(
    exportUpdatesSince(aliceDoc, null),
    rotateProbe.currentAccessEpoch,
    rotatedDocumentEncryption.documentKey,
  );

  const missingSourceResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: rotateProbe.currentAccessEpoch,
      documentRecipientEnvelopes:
        rotatedDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: rotateBaseline,
          partialStartVersionVector: initialVectors.partialStartVersionVector,
          partialEndVersionVector: initialVectors.partialEndVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(missingSourceResponse.status).toBe(400);
  expect(await missingSourceResponse.json()).toEqual({
    error: "Missing rotate baseline source version vector",
  });

  const staleSourceResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: rotateProbe.currentAccessEpoch,
      documentRecipientEnvelopes:
        rotatedDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: rotateBaseline,
          partialStartVersionVector: initialVectors.partialStartVersionVector,
          partialEndVersionVector: initialVectors.partialEndVersionVector,
          sourceVersionVector: initialVectors.partialStartVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(staleSourceResponse.status).toBe(409);
  expect(await staleSourceResponse.json()).toEqual({
    error: "Stale rotate baseline source version vector",
  });

  const sourceOmittingBaselineResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: rotateProbe.currentAccessEpoch,
      documentRecipientEnvelopes:
        rotatedDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: rotateBaseline,
          partialStartVersionVector: initialVectors.partialStartVersionVector,
          partialEndVersionVector: initialVectors.partialStartVersionVector,
          sourceVersionVector: rotateProbe.rotateBaselineSourceVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(sourceOmittingBaselineResponse.status).toBe(409);
  expect(await sourceOmittingBaselineResponse.json()).toEqual({
    error: "Rotate baseline frontier does not cover all prior-epoch updates",
  });

  const acceptedRotateResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: rotateProbe.currentAccessEpoch,
      documentRecipientEnvelopes:
        rotatedDocumentEncryption.documentRecipientEnvelopes,
      localVersionVector: encodeVersionVector(aliceDoc),
      outgoingUpdates: [
        {
          id: crypto.randomUUID(),
          encryptedData: rotateBaseline,
          partialStartVersionVector: initialVectors.partialStartVersionVector,
          partialEndVersionVector: initialVectors.partialEndVersionVector,
          sourceVersionVector: rotateProbe.rotateBaselineSourceVersionVector,
        },
      ],
    },
    alice.token,
  );
  expect(acceptedRotateResponse.status).toBe(200);
  const acceptedRotate = await acceptedRotateResponse.json();
  expect(acceptedRotate.acceptedOutgoingUpdateIds).toHaveLength(1);
  expect(acceptedRotate.currentAccessEpoch).toBe(3);
  expect(acceptedRotate.documentRecipientEnvelopeAction).toBe("rotate");
  expect(acceptedRotate.documentRecipientEnvelopes).toEqual(
    rotatedDocumentEncryption.documentRecipientEnvelopes,
  );

  const coldSyncResponse = await syncDocument(
    sharedDocumentId,
    {
      accessEpoch: acceptedRotate.currentAccessEpoch,
      localVersionVector: "AA==",
      outgoingUpdates: [],
    },
    alice.token,
  );
  expect(coldSyncResponse.status).toBe(200);
  const coldSync = await coldSyncResponse.json();
  expect(coldSync.missingUpdateEpochs).toEqual([
    "prior_epoch",
    "current_epoch",
  ]);
  expect(coldSync.updates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accessEpoch: 2 }),
      expect.objectContaining({ accessEpoch: 3 }),
    ]),
  );
});
