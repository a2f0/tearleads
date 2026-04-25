import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  SerializedRecipientEnvelope,
  SyncDocumentResponse,
} from "@tearleads/loro";
import {
  createDocument,
  encryptLoroUpdate,
  exportAllUpdates,
  type SyncDocumentOutgoingUpdate,
} from "@tearleads/loro";
import {
  createDocumentEncryptionMaterial,
  decryptIncomingUpdates,
  getOrCreateDocumentEncryptionMaterial,
  maybeSeedRewrappedDocumentRecipientEnvelopes,
  resolveIncomingUpdateDecryptionBatches,
} from "./documentSync";

function createEnvelope(keyFingerprint: string): SerializedRecipientEnvelope {
  return {
    kemCipherText: `kem-${keyFingerprint}`,
    keyFingerprint,
    wrappedKey: `wrapped-${keyFingerprint}`,
  };
}

function createSyncUpdate(input: {
  accessEpoch: number;
  id: string;
}): SyncDocumentResponse["updates"][number] {
  return {
    accessEpoch: input.accessEpoch,
    authorFingerprint: `author-${input.id}`,
    createdAt: "2026-04-10T00:00:00.000Z",
    documentId: "document-1",
    encryptedData: `encrypted-${input.id}`,
    id: input.id,
    partialEndVersionVector: `end-${input.id}`,
    partialStartVersionVector: `start-${input.id}`,
  };
}

function createSyncResponse(input: {
  currentAccessEpoch?: number;
  currentAccessStateHash?: string;
  updates: SyncDocumentResponse["updates"];
}): SyncDocumentResponse {
  const currentAccessEpoch = input.currentAccessEpoch ?? 2;

  return {
    acceptedOutgoingUpdateIds: [],
    canonicalDocumentRecipientEnvelopesAdopted: false,
    commitLsn: null,
    currentAccessEpoch,
    currentAccessStateHash:
      input.currentAccessStateHash ?? `access-state-hash-${currentAccessEpoch}`,
    documentId: "document-1",
    documentRecipientEnvelopeAction: "rotate",
    documentRecipientEnvelopes: [createEnvelope("current")],
    missingUpdateEpochs: ["prior_epoch", "current_epoch"],
    recipientEncapsulationPublicKeys: [],
    rotateBaselineSourceVersionVector: "source-frontier",
    updates: input.updates,
  };
}

test("incoming update decryption batches separate prior and current epochs", () => {
  const previousEnvelopes = [createEnvelope("previous")];
  const currentEnvelopes = [createEnvelope("current")];
  const synced = createSyncResponse({
    updates: [
      createSyncUpdate({ accessEpoch: 2, id: "current-update" }),
      createSyncUpdate({ accessEpoch: 1, id: "prior-update" }),
    ],
  });

  const batches = resolveIncomingUpdateDecryptionBatches({
    currentDocumentRecipientEnvelopes: previousEnvelopes,
    nextDocumentRecipientEnvelopes: currentEnvelopes,
    previousAccessEpoch: 1,
    synced,
  });

  expect(batches).toEqual([
    {
      accessEpoch: 1,
      documentRecipientEnvelopes: previousEnvelopes,
      updates: [createSyncUpdate({ accessEpoch: 1, id: "prior-update" })],
    },
    {
      accessEpoch: 2,
      documentRecipientEnvelopes: currentEnvelopes,
      updates: [createSyncUpdate({ accessEpoch: 2, id: "current-update" })],
    },
  ]);
});

test("incoming update decryption batches use current envelopes for intermediate epochs", () => {
  const previousEnvelopes = [createEnvelope("previous")];
  const currentEnvelopes = [createEnvelope("current")];
  const synced = createSyncResponse({
    currentAccessEpoch: 3,
    updates: [
      createSyncUpdate({ accessEpoch: 3, id: "current-update" }),
      createSyncUpdate({ accessEpoch: 2, id: "intermediate-update" }),
      createSyncUpdate({ accessEpoch: 1, id: "prior-update" }),
    ],
  });

  const batches = resolveIncomingUpdateDecryptionBatches({
    currentDocumentRecipientEnvelopes: previousEnvelopes,
    nextDocumentRecipientEnvelopes: currentEnvelopes,
    previousAccessEpoch: 1,
    synced,
  });

  expect(batches).toEqual([
    {
      accessEpoch: 1,
      documentRecipientEnvelopes: previousEnvelopes,
      updates: [createSyncUpdate({ accessEpoch: 1, id: "prior-update" })],
    },
    {
      accessEpoch: 2,
      documentRecipientEnvelopes: currentEnvelopes,
      updates: [
        createSyncUpdate({ accessEpoch: 2, id: "intermediate-update" }),
      ],
    },
    {
      accessEpoch: 3,
      documentRecipientEnvelopes: currentEnvelopes,
      updates: [createSyncUpdate({ accessEpoch: 3, id: "current-update" })],
    },
  ]);
});

test("incoming update decryption batches cold syncs prior epochs with current envelopes", () => {
  const currentEnvelopes = [createEnvelope("current")];
  const synced = createSyncResponse({
    currentAccessEpoch: 3,
    updates: [
      createSyncUpdate({ accessEpoch: 1, id: "prior-update" }),
      createSyncUpdate({ accessEpoch: 2, id: "intermediate-update" }),
      createSyncUpdate({ accessEpoch: 3, id: "current-update" }),
    ],
  });

  const batches = resolveIncomingUpdateDecryptionBatches({
    currentDocumentRecipientEnvelopes: null,
    nextDocumentRecipientEnvelopes: currentEnvelopes,
    previousAccessEpoch: 3,
    synced,
  });

  expect(batches).toEqual([
    {
      accessEpoch: 1,
      documentRecipientEnvelopes: currentEnvelopes,
      updates: [createSyncUpdate({ accessEpoch: 1, id: "prior-update" })],
    },
    {
      accessEpoch: 2,
      documentRecipientEnvelopes: currentEnvelopes,
      updates: [
        createSyncUpdate({ accessEpoch: 2, id: "intermediate-update" }),
      ],
    },
    {
      accessEpoch: 3,
      documentRecipientEnvelopes: currentEnvelopes,
      updates: [createSyncUpdate({ accessEpoch: 3, id: "current-update" })],
    },
  ]);
});

test("incoming update decryption batches omit epochs without key material", () => {
  const synced = createSyncResponse({
    updates: [createSyncUpdate({ accessEpoch: 1, id: "unknown-prior-update" })],
  });

  const batches = resolveIncomingUpdateDecryptionBatches({
    currentDocumentRecipientEnvelopes: null,
    nextDocumentRecipientEnvelopes: null,
    previousAccessEpoch: 1,
    synced,
  });

  expect(batches).toEqual([]);
});

test("additive rewrap preserves prior-epoch decryptability for a newly added recipient", async () => {
  const ownerKeyPair = generateKemSeedAndKeyPair();
  const peerKeyPair = generateKemSeedAndKeyPair();
  const initialEncryption = await createDocumentEncryptionMaterial([
    ownerKeyPair.publicKey,
  ]);
  const ownerMaterial = await getOrCreateDocumentEncryptionMaterial({
    documentRecipientEnvelopes: initialEncryption.documentRecipientEnvelopes,
    recipientPublicKeys: [ownerKeyPair.publicKey],
    secretKey: ownerKeyPair.secretKey,
  });
  const remoteDoc = await createDocument("rewrap-prior-update");
  remoteDoc.getText("text").update("prior epoch update");
  const remoteUpdate = exportAllUpdates(remoteDoc);
  const remoteUpdateVectors = createSyncUpdate({
    accessEpoch: 1,
    id: "prior-update",
  });
  const syncCalls: Array<{
    accessEpoch: number;
    documentRecipientEnvelopeCount: number;
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];

  const seeded = await maybeSeedRewrappedDocumentRecipientEnvelopes({
    currentAccessEpoch: 1,
    currentDocumentRecipientEnvelopes:
      initialEncryption.documentRecipientEnvelopes,
    documentId: "document-1",
    localVersionVector: null,
    minLsn: "0/10",
    recipientPublicKeys: [ownerKeyPair.publicKey, peerKeyPair.publicKey],
    secretKey: ownerKeyPair.secretKey,
    syncDocument: async (
      documentId: string,
      accessEpoch: number,
      _localVersionVector: string | null,
      outgoingUpdates: SyncDocumentOutgoingUpdate[],
      documentRecipientEnvelopes?: SerializedRecipientEnvelope[],
      minLsn?: string,
    ) => {
      syncCalls.push({
        accessEpoch,
        documentRecipientEnvelopeCount: documentRecipientEnvelopes?.length ?? 0,
        minLsn: minLsn ?? null,
        outgoingUpdateCount: outgoingUpdates.length,
      });

      return {
        acceptedOutgoingUpdateIds: [],
        canonicalDocumentRecipientEnvelopesAdopted: false,
        commitLsn: "0/20",
        currentAccessEpoch: accessEpoch,
        currentAccessStateHash: `access-state-hash-${accessEpoch}`,
        documentId,
        documentRecipientEnvelopeAction: "none",
        documentRecipientEnvelopes: documentRecipientEnvelopes ?? null,
        missingUpdateEpochs: ["prior_epoch"],
        recipientEncapsulationPublicKeys: [],
        rotateBaselineSourceVersionVector: null,
        updates: [
          {
            ...remoteUpdateVectors,
            encryptedData: await encryptLoroUpdate(
              remoteUpdate,
              1,
              ownerMaterial.documentKey,
            ),
          },
        ],
      };
    },
    synced: {
      acceptedOutgoingUpdateIds: [],
      canonicalDocumentRecipientEnvelopesAdopted: false,
      commitLsn: "0/10",
      currentAccessEpoch: 2,
      currentAccessStateHash: "access-state-hash-2",
      documentId: "document-1",
      documentRecipientEnvelopeAction: "rewrap",
      documentRecipientEnvelopes: null,
      missingUpdateEpochs: ["prior_epoch"],
      recipientEncapsulationPublicKeys: [],
      rotateBaselineSourceVersionVector: null,
      updates: [],
    },
  });

  expect(syncCalls).toEqual([
    {
      accessEpoch: 2,
      documentRecipientEnvelopeCount: 2,
      minLsn: "0/10",
      outgoingUpdateCount: 0,
    },
  ]);
  expect(seeded.currentAccessEpoch).toBe(2);
  expect(seeded.documentRecipientEnvelopeAction).toBe("none");
  expect(seeded.documentRecipientEnvelopes).toHaveLength(2);
  const seededEnvelopes = seeded.documentRecipientEnvelopes ?? [];

  const peerMaterial = await getOrCreateDocumentEncryptionMaterial({
    documentRecipientEnvelopes: seededEnvelopes,
    recipientPublicKeys: [ownerKeyPair.publicKey, peerKeyPair.publicKey],
    secretKey: peerKeyPair.secretKey,
  });
  expect(Array.from(peerMaterial.documentKey)).toEqual(
    Array.from(ownerMaterial.documentKey),
  );

  const decryptionBatches = resolveIncomingUpdateDecryptionBatches({
    currentDocumentRecipientEnvelopes: null,
    nextDocumentRecipientEnvelopes: seededEnvelopes,
    previousAccessEpoch: 2,
    synced: seeded,
  });
  expect(decryptionBatches).toHaveLength(1);
  expect(decryptionBatches[0]).toEqual({
    accessEpoch: 1,
    documentRecipientEnvelopes: seededEnvelopes,
    updates: seeded.updates,
  });

  const skippedLogs: string[] = [];
  const decryptedUpdates = await decryptIncomingUpdates(
    decryptionBatches[0]?.updates ?? [],
    decryptionBatches[0]?.accessEpoch ?? 1,
    peerMaterial.documentKey,
    (message) => skippedLogs.push(message),
  );

  expect(skippedLogs).toEqual([]);
  expect(decryptedUpdates).toHaveLength(1);
  expect(Array.from(decryptedUpdates[0] ?? new Uint8Array())).toEqual(
    Array.from(remoteUpdate),
  );
});

test("rewrap seeding prefers synced recipient public keys over stale local keys", async () => {
  const ownerKeyPair = generateKemSeedAndKeyPair();
  const peerKeyPair = generateKemSeedAndKeyPair();
  const initialEncryption = await createDocumentEncryptionMaterial([
    ownerKeyPair.publicKey,
  ]);
  const syncCalls: Array<{
    accessEpoch: number;
    documentRecipientEnvelopeCount: number;
  }> = [];

  const seeded = await maybeSeedRewrappedDocumentRecipientEnvelopes({
    currentAccessEpoch: 1,
    currentDocumentRecipientEnvelopes:
      initialEncryption.documentRecipientEnvelopes,
    documentId: "document-1",
    localVersionVector: null,
    minLsn: "0/10",
    recipientPublicKeys: [ownerKeyPair.publicKey],
    secretKey: ownerKeyPair.secretKey,
    syncDocument: async (
      documentId: string,
      accessEpoch: number,
      _localVersionVector: string | null,
      _outgoingUpdates: SyncDocumentOutgoingUpdate[],
      documentRecipientEnvelopes?: SerializedRecipientEnvelope[],
    ) => {
      syncCalls.push({
        accessEpoch,
        documentRecipientEnvelopeCount: documentRecipientEnvelopes?.length ?? 0,
      });

      return {
        acceptedOutgoingUpdateIds: [],
        canonicalDocumentRecipientEnvelopesAdopted: false,
        commitLsn: "0/20",
        currentAccessEpoch: accessEpoch,
        currentAccessStateHash: `access-state-hash-${accessEpoch}`,
        documentId,
        documentRecipientEnvelopeAction: "none",
        documentRecipientEnvelopes: documentRecipientEnvelopes ?? null,
        missingUpdateEpochs: [],
        recipientEncapsulationPublicKeys: [],
        rotateBaselineSourceVersionVector: null,
        updates: [],
      };
    },
    synced: {
      acceptedOutgoingUpdateIds: [],
      canonicalDocumentRecipientEnvelopesAdopted: false,
      commitLsn: "0/10",
      currentAccessEpoch: 2,
      currentAccessStateHash: "access-state-hash-2",
      documentId: "document-1",
      documentRecipientEnvelopeAction: "rewrap",
      documentRecipientEnvelopes: null,
      missingUpdateEpochs: [],
      recipientEncapsulationPublicKeys: [
        bytesToBase64(ownerKeyPair.publicKey),
        bytesToBase64(peerKeyPair.publicKey),
      ],
      rotateBaselineSourceVersionVector: null,
      updates: [],
    },
  });

  expect(syncCalls).toEqual([
    {
      accessEpoch: 2,
      documentRecipientEnvelopeCount: 2,
    },
  ]);
  expect(seeded.documentRecipientEnvelopes).toHaveLength(2);

  const peerMaterial = await getOrCreateDocumentEncryptionMaterial({
    documentRecipientEnvelopes: seeded.documentRecipientEnvelopes,
    recipientPublicKeys: [ownerKeyPair.publicKey, peerKeyPair.publicKey],
    secretKey: peerKeyPair.secretKey,
  });
  expect(peerMaterial.documentRecipientEnvelopes).toHaveLength(2);
});

test("rewrap seeding can materialize current-epoch envelopes after local access epoch already advanced", async () => {
  const ownerKeyPair = generateKemSeedAndKeyPair();
  const peerKeyPair = generateKemSeedAndKeyPair();
  const initialEncryption = await createDocumentEncryptionMaterial([
    ownerKeyPair.publicKey,
  ]);
  const syncCalls: Array<{
    accessEpoch: number;
    documentRecipientEnvelopeCount: number;
    outgoingUpdateCount: number;
  }> = [];

  const seeded = await maybeSeedRewrappedDocumentRecipientEnvelopes({
    currentAccessEpoch: 2,
    currentDocumentRecipientEnvelopes:
      initialEncryption.documentRecipientEnvelopes,
    documentId: "document-1",
    localVersionVector: null,
    recipientPublicKeys: [ownerKeyPair.publicKey],
    secretKey: ownerKeyPair.secretKey,
    syncDocument: async (
      documentId: string,
      accessEpoch: number,
      _localVersionVector: string | null,
      outgoingUpdates: SyncDocumentOutgoingUpdate[],
      documentRecipientEnvelopes?: SerializedRecipientEnvelope[],
    ) => {
      syncCalls.push({
        accessEpoch,
        documentRecipientEnvelopeCount: documentRecipientEnvelopes?.length ?? 0,
        outgoingUpdateCount: outgoingUpdates.length,
      });

      return {
        acceptedOutgoingUpdateIds: [],
        canonicalDocumentRecipientEnvelopesAdopted: false,
        commitLsn: "0/20",
        currentAccessEpoch: accessEpoch,
        currentAccessStateHash: `access-state-hash-${accessEpoch}`,
        documentId,
        documentRecipientEnvelopeAction: "none",
        documentRecipientEnvelopes: documentRecipientEnvelopes ?? null,
        missingUpdateEpochs: [],
        recipientEncapsulationPublicKeys: [],
        rotateBaselineSourceVersionVector: null,
        updates: [],
      };
    },
    synced: {
      acceptedOutgoingUpdateIds: [],
      canonicalDocumentRecipientEnvelopesAdopted: false,
      commitLsn: "0/10",
      currentAccessEpoch: 2,
      currentAccessStateHash: "access-state-hash-2",
      documentId: "document-1",
      documentRecipientEnvelopeAction: "rewrap",
      documentRecipientEnvelopes: null,
      missingUpdateEpochs: [],
      recipientEncapsulationPublicKeys: [
        bytesToBase64(ownerKeyPair.publicKey),
        bytesToBase64(peerKeyPair.publicKey),
      ],
      rotateBaselineSourceVersionVector: null,
      updates: [],
    },
  });

  expect(syncCalls).toEqual([
    {
      accessEpoch: 2,
      documentRecipientEnvelopeCount: 2,
      outgoingUpdateCount: 0,
    },
  ]);
  expect(seeded.currentAccessEpoch).toBe(2);
  expect(seeded.documentRecipientEnvelopeAction).toBe("none");
  expect(seeded.documentRecipientEnvelopes).toHaveLength(2);
});
