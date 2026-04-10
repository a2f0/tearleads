import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { SyncDocumentResponse } from "@tearleads/loro";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/documentPersistence";
import { type ContactsRuntime, createContactsStore } from "./ContactsProvider";
import type {
  ContactPendingUpdateInsert,
  ContactsPersistence,
} from "./contactsPersistence";

interface StoredContactState {
  entry: {
    encapsulationPublicKey: string;
    isSelf: boolean;
    userId: string;
  };
  record: DocumentRecord | null;
}

function createSyncDocumentResponse(input: {
  accessEpoch: number;
  documentId: string;
  recipientEncapsulationPublicKeys: string[];
  acceptedOutgoingUpdateIds?: string[];
  canonicalDocumentRecipientEnvelopesAdopted?: boolean;
  documentRecipientEnvelopeAction?: SyncDocumentResponse["documentRecipientEnvelopeAction"];
  documentRecipientEnvelopes?: SyncDocumentResponse["documentRecipientEnvelopes"];
  missingUpdateEpochs?: SyncDocumentResponse["missingUpdateEpochs"];
  rotateBaselineSourceVersionVector?: string | null;
  updates?: SyncDocumentResponse["updates"];
}): SyncDocumentResponse {
  return {
    acceptedOutgoingUpdateIds: input.acceptedOutgoingUpdateIds ?? [],
    canonicalDocumentRecipientEnvelopesAdopted:
      input.canonicalDocumentRecipientEnvelopesAdopted ?? false,
    currentAccessEpoch: input.accessEpoch,
    documentId: input.documentId,
    documentRecipientEnvelopeAction:
      input.documentRecipientEnvelopeAction ?? "none",
    documentRecipientEnvelopes: input.documentRecipientEnvelopes ?? null,
    missingUpdateEpochs: input.missingUpdateEpochs ?? [],
    rotateBaselineSourceVersionVector:
      input.rotateBaselineSourceVersionVector ?? null,
    recipientEncapsulationPublicKeys: input.recipientEncapsulationPublicKeys,
    updates: input.updates ?? [],
  };
}

function sortContacts(
  contacts: Iterable<StoredContactState>,
): StoredContactState[] {
  return [...contacts].sort((left, right) =>
    left.entry.userId.localeCompare(right.entry.userId),
  );
}

function createContactsPersistence(): ContactsPersistence & {
  getContact: (userId: string) => StoredContactState | null;
  getPendingUpdates: (userId: string) => PendingUpdateRecord[];
  getState: () => {
    contacts: StoredContactState[];
    pendingUpdates: PendingUpdateRecord[];
  };
} {
  const contacts = new Map<string, StoredContactState>();
  const pendingUpdatesByUserId = new Map<string, PendingUpdateRecord[]>();

  return {
    async ensureSchema() {},
    getContact(userId) {
      return contacts.get(userId) ?? null;
    },
    getPendingUpdates(userId) {
      return [...(pendingUpdatesByUserId.get(userId) ?? [])];
    },
    getState() {
      return {
        contacts: sortContacts(contacts.values()),
        pendingUpdates: Array.from(pendingUpdatesByUserId.values()).flat(),
      };
    },
    async loadContacts() {
      return sortContacts(contacts.values()).map((contact) => ({
        entry: { ...contact.entry },
        record: contact.record,
      }));
    },
    async saveContact(_execSql, _addressBookId, nextRecord, entry) {
      contacts.set(entry.userId, {
        entry: { ...entry },
        record: nextRecord,
      });
    },
    async deleteContact(_execSql, _addressBookId, userId) {
      contacts.delete(userId);
      pendingUpdatesByUserId.delete(userId);
    },
    async listPendingUpdates(_execSql, userId) {
      return [...(pendingUpdatesByUserId.get(userId) ?? [])];
    },
    async enqueuePendingUpdate(
      _execSql,
      pendingUpdate: ContactPendingUpdateInsert,
    ) {
      const nextPendingUpdate: PendingUpdateRecord = {
        id: `pending-${pendingUpdate.userId}-${(pendingUpdatesByUserId.get(pendingUpdate.userId) ?? []).length + 1}`,
        partialEndVersionVector: pendingUpdate.partialEndVersionVector,
        partialStartVersionVector: pendingUpdate.partialStartVersionVector,
        sourceVersionVector: pendingUpdate.sourceVersionVector ?? null,
        updateData: pendingUpdate.updateData,
      };

      pendingUpdatesByUserId.set(pendingUpdate.userId, [
        ...(pendingUpdatesByUserId.get(pendingUpdate.userId) ?? []),
        nextPendingUpdate,
      ]);
    },
    async deletePendingUpdate(_execSql, id) {
      for (const [userId, pendingUpdates] of pendingUpdatesByUserId) {
        const nextPendingUpdates = pendingUpdates.filter(
          (pendingUpdate) => pendingUpdate.id !== id,
        );
        if (nextPendingUpdates.length === pendingUpdates.length) {
          continue;
        }

        if (nextPendingUpdates.length === 0) {
          pendingUpdatesByUserId.delete(userId);
        } else {
          pendingUpdatesByUserId.set(userId, nextPendingUpdates);
        }
      }
    },
    async deletePendingUpdates(_execSql, userId) {
      pendingUpdatesByUserId.delete(userId);
    },
  };
}

function createRuntime(userIdToImport?: string): ContactsRuntime {
  return {
    apiClient: {
      getEncapsulationKey: async (userId: string) => {
        if (userId !== userIdToImport) {
          return null;
        }

        return {
          encapsulationPublicKey: `${userId}-key`,
          userId,
        };
      },
      createDocument: async (_linkedContainerIds) => null,
      syncDocument: async () => null,
    },
    cacheReferencedPrincipalPolicies: async () => {},
    containerId: "root-container",
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair: null,
    events: [],
    execSql: async () => [],
    isAuthenticated: false,
    log: () => {},
    online: false,
  };
}

function createSyncRuntime(
  encapsulationKeyPair: NonNullable<ContactsRuntime["encapsulationKeyPair"]>,
): ContactsRuntime {
  return {
    apiClient: {
      getEncapsulationKey: async (userId: string) => ({
        encapsulationPublicKey: `${userId}-key`,
        userId,
      }),
      createDocument: async (_linkedContainerIds) => ({
        id: "contacts-document-1",
        createdAt: "2026-03-31T00:00:00.000Z",
        currentAccessEpoch: 1,
        documentRecipientEnvelopes: null,
        recipientEncapsulationPublicKeys: [
          bytesToBase64(encapsulationKeyPair.publicKey),
        ],
      }),
      syncDocument: async (
        documentId,
        accessEpoch,
        _localVersionVector,
        outgoingUpdates,
        documentRecipientEnvelopes,
      ) =>
        createSyncDocumentResponse({
          acceptedOutgoingUpdateIds: outgoingUpdates.map((update) => update.id),
          accessEpoch,
          documentId,
          documentRecipientEnvelopes: documentRecipientEnvelopes ?? null,
          recipientEncapsulationPublicKeys: [
            bytesToBase64(encapsulationKeyPair.publicKey),
          ],
        }),
    },
    cacheReferencedPrincipalPolicies: async () => {},
    containerId: "root-container",
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair,
    events: [],
    execSql: async () => [],
    isAuthenticated: true,
    log: () => {},
    online: true,
  };
}

test("contacts store reloads persisted address book entries", async () => {
  const persistence = createContactsPersistence();

  const firstRuntime = createRuntime("peer-user-1");
  const firstStore = createContactsStore(firstRuntime, persistence);
  firstStore.updateRuntime(firstRuntime);
  await waitForCondition(
    () => firstStore.getSnapshot().ready,
    "First contacts store did not become ready.",
  );

  expect(firstStore.getSnapshot()).toEqual({
    entries: [],
    ready: true,
  });

  await firstStore.importKey("peer-user-1");

  expect(firstStore.getSnapshot()).toEqual({
    entries: [
      {
        encapsulationPublicKey: "peer-user-1-key",
        isSelf: false,
        userId: "peer-user-1",
      },
    ],
    ready: true,
  });
  expect(persistence.getContact("peer-user-1")?.record).not.toBeNull();
  expect(persistence.getPendingUpdates("peer-user-1")).toHaveLength(1);

  const secondRuntime = createRuntime();
  const secondStore = createContactsStore(secondRuntime, persistence);
  secondStore.updateRuntime(secondRuntime);
  await waitForCondition(
    () => secondStore.getSnapshot().ready,
    "Second contacts store did not become ready.",
  );

  expect(secondStore.getSnapshot()).toEqual({
    entries: [
      {
        encapsulationPublicKey: "peer-user-1-key",
        isSelf: false,
        userId: "peer-user-1",
      },
    ],
    ready: true,
  });

  await secondStore.removeKey("peer-user-1");

  expect(persistence.getState()).toEqual({
    contacts: [],
    pendingUpdates: [],
  });

  const thirdRuntime = createRuntime();
  const thirdStore = createContactsStore(thirdRuntime, persistence);
  thirdStore.updateRuntime(thirdRuntime);
  await waitForCondition(
    () => thirdStore.getSnapshot().ready,
    "Third contacts store did not become ready.",
  );

  expect(thirdStore.getSnapshot()).toEqual({
    entries: [],
    ready: true,
  });
});

test("contacts store creates and syncs a contact document", async () => {
  const persistence = createContactsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const cachedPrincipalReferences: Array<
    ReadonlyArray<{
      keyEpoch: number;
      principalId: string;
      principalType: "group" | "organization";
      stateHash: string;
      version: number;
    }>
  > = [];
  const createDocumentCalls: string[][] = [];
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    outgoingUpdateCount: number;
  }> = [];

  const runtime = createSyncRuntime(encapsulationKeyPair);
  const instrumentedRuntime: ContactsRuntime = {
    ...runtime,
    cacheReferencedPrincipalPolicies: async (references) => {
      cachedPrincipalReferences.push(references ?? []);
    },
    apiClient: {
      ...runtime.apiClient,
      createDocument: async (linkedContainerIds) => {
        createDocumentCalls.push(linkedContainerIds);
        const created =
          await runtime.apiClient.createDocument(linkedContainerIds);
        if (!created) {
          return null;
        }

        return {
          ...created,
          referencedPrincipals: [
            {
              keyEpoch: 1,
              principalId: "group-1",
              principalType: "group",
              stateHash: "state-hash-1",
              version: 1,
            },
          ],
        };
      },
      syncDocument: async (
        documentId,
        accessEpoch,
        localVersionVector,
        outgoingUpdates,
        documentRecipientEnvelopes,
      ) => {
        syncDocumentCalls.push({
          accessEpoch,
          documentId,
          documentRecipientEnvelopeCount:
            documentRecipientEnvelopes?.length ?? 0,
          outgoingUpdateCount: outgoingUpdates.length,
        });
        return runtime.apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
          documentRecipientEnvelopes,
        );
      },
    },
  };
  const store = createContactsStore(instrumentedRuntime, persistence);

  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Contacts sync store did not become ready.",
  );

  await store.importKey("peer-user-1");

  await waitForCondition(
    () =>
      createDocumentCalls.length === 1 &&
      syncDocumentCalls.length === 1 &&
      persistence.getPendingUpdates("peer-user-1").length === 0 &&
      persistence.getContact("peer-user-1")?.record?.documentId ===
        "contacts-document-1",
    "Contact document was not synced.",
  );

  expect(syncDocumentCalls).toEqual([
    {
      accessEpoch: 1,
      documentId: "contacts-document-1",
      documentRecipientEnvelopeCount: 1,
      outgoingUpdateCount: 1,
    },
  ]);
  expect(createDocumentCalls).toEqual([["root-container"]]);
  expect(cachedPrincipalReferences).toContainEqual([
    {
      keyEpoch: 1,
      principalId: "group-1",
      principalType: "group",
      stateHash: "state-hash-1",
      version: 1,
    },
  ]);
});

test("contacts store rewraps document access expansion without replacing pending updates with a baseline", async () => {
  const persistence = createContactsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const createDocumentCalls: string[][] = [];
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    outgoingUpdateIds: string[];
    outgoingUpdateCount: number;
  }> = [];
  let importedEncapsulationPublicKey = "peer-user-1-key";
  let syncCallCount = 0;

  const runtime = createSyncRuntime(encapsulationKeyPair);
  const instrumentedRuntime: ContactsRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      createDocument: async (linkedContainerIds) => {
        createDocumentCalls.push(linkedContainerIds);
        return runtime.apiClient.createDocument(linkedContainerIds);
      },
      getEncapsulationKey: async (userId: string) => ({
        encapsulationPublicKey: importedEncapsulationPublicKey,
        userId,
      }),
      syncDocument: async (
        documentId,
        accessEpoch,
        localVersionVector,
        outgoingUpdates,
        documentRecipientEnvelopes,
      ) => {
        syncCallCount += 1;
        syncDocumentCalls.push({
          accessEpoch,
          documentId,
          documentRecipientEnvelopeCount:
            documentRecipientEnvelopes?.length ?? 0,
          outgoingUpdateIds: outgoingUpdates.map((update) => update.id),
          outgoingUpdateCount: outgoingUpdates.length,
        });

        if (syncCallCount === 2) {
          return createSyncDocumentResponse({
            acceptedOutgoingUpdateIds: [],
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "rewrap",
            recipientEncapsulationPublicKeys: [
              bytesToBase64(encapsulationKeyPair.publicKey),
            ],
          });
        }

        return runtime.apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
          documentRecipientEnvelopes,
        );
      },
    },
  };
  const store = createContactsStore(instrumentedRuntime, persistence);

  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Contacts sync store did not become ready.",
  );

  await store.importKey("peer-user-1");

  await waitForCondition(
    () =>
      createDocumentCalls.length === 1 &&
      syncDocumentCalls.length === 1 &&
      persistence.getPendingUpdates("peer-user-1").length === 0 &&
      persistence.getContact("peer-user-1")?.record?.documentId ===
        "contacts-document-1",
    "Initial contact document sync did not complete.",
  );

  importedEncapsulationPublicKey = "peer-user-1-key-2";
  await store.importKey("peer-user-1");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 4 &&
      persistence.getPendingUpdates("peer-user-1").length === 0 &&
      persistence.getContact("peer-user-1")?.record?.accessEpoch === 2,
    "Expanded access epoch did not rewrap and retry the pending contact update.",
  );

  expect(createDocumentCalls).toEqual([["root-container"]]);
  expect(
    syncDocumentCalls.map((call) => ({
      accessEpoch: call.accessEpoch,
      documentId: call.documentId,
      documentRecipientEnvelopeCount: call.documentRecipientEnvelopeCount,
      outgoingUpdateCount: call.outgoingUpdateCount,
    })),
  ).toEqual([
    {
      accessEpoch: 1,
      documentId: "contacts-document-1",
      documentRecipientEnvelopeCount: 1,
      outgoingUpdateCount: 1,
    },
    {
      accessEpoch: 1,
      documentId: "contacts-document-1",
      documentRecipientEnvelopeCount: 0,
      outgoingUpdateCount: 1,
    },
    {
      accessEpoch: 2,
      documentId: "contacts-document-1",
      documentRecipientEnvelopeCount: 1,
      outgoingUpdateCount: 0,
    },
    {
      accessEpoch: 2,
      documentId: "contacts-document-1",
      documentRecipientEnvelopeCount: 0,
      outgoingUpdateCount: 1,
    },
  ]);
  expect(syncDocumentCalls[1]?.outgoingUpdateIds).toHaveLength(1);
  expect(syncDocumentCalls[3]?.outgoingUpdateIds).toEqual(
    syncDocumentCalls[1]?.outgoingUpdateIds,
  );
});
