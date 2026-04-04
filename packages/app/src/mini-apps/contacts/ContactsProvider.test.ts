import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
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
        recipientEncapsulationPublicKeys: [
          bytesToBase64(encapsulationKeyPair.publicKey),
        ],
      }),
      syncDocument: async (
        documentId,
        accessEpoch,
        _localVersionVector,
        outgoingUpdates,
      ) => ({
        documentId,
        acceptedOutgoingUpdateIds: outgoingUpdates.map((update) => update.id),
        updates: [],
        currentAccessEpoch: accessEpoch,
        recipientEncapsulationPublicKeys: [
          bytesToBase64(encapsulationKeyPair.publicKey),
        ],
      }),
    },
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
  const createDocumentCalls: string[][] = [];
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    documentId: string;
    outgoingUpdateCount: number;
  }> = [];

  const runtime = createSyncRuntime(encapsulationKeyPair);
  const instrumentedRuntime: ContactsRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      createDocument: async (linkedContainerIds) => {
        createDocumentCalls.push(linkedContainerIds);
        return runtime.apiClient.createDocument(linkedContainerIds);
      },
      syncDocument: async (
        documentId,
        accessEpoch,
        localVersionVector,
        outgoingUpdates,
      ) => {
        syncDocumentCalls.push({
          accessEpoch,
          documentId,
          outgoingUpdateCount: outgoingUpdates.length,
        });
        return runtime.apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
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
      outgoingUpdateCount: 1,
    },
  ]);
  expect(createDocumentCalls).toEqual([["root-container"]]);
});
