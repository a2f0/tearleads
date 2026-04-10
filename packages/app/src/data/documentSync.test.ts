import { expect, test } from "bun:test";
import type {
  SerializedRecipientEnvelope,
  SyncDocumentResponse,
} from "@tearleads/loro";
import { resolveIncomingUpdateDecryptionBatches } from "./documentSync";

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
  updates: SyncDocumentResponse["updates"];
}): SyncDocumentResponse {
  return {
    acceptedOutgoingUpdateIds: [],
    canonicalDocumentRecipientEnvelopesAdopted: false,
    currentAccessEpoch: input.currentAccessEpoch ?? 2,
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
