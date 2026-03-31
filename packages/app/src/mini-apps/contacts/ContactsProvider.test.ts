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
  AddressBookPendingUpdateInsert,
  ContactsPersistence,
} from "./contactsPersistence";

interface StoredContactsState {
  entries: {
    encapsulationPublicKey: string;
    userId: string;
  }[];
  pendingUpdates: PendingUpdateRecord[];
  record: DocumentRecord | null;
}

function createContactsPersistence(): ContactsPersistence & {
  getState: () => StoredContactsState;
} {
  let entries: StoredContactsState["entries"] = [];
  let pendingUpdates: PendingUpdateRecord[] = [];
  let record: DocumentRecord | null = null;

  return {
    async ensureSchema() {},
    getState() {
      return { entries, pendingUpdates, record };
    },
    async loadAddressBook() {
      return {
        entries: [...entries],
        record,
      };
    },
    async saveAddressBook(_execSql, nextRecord, nextEntries) {
      record = nextRecord;
      entries = [...nextEntries].sort((left, right) =>
        left.userId.localeCompare(right.userId),
      );
    },
    async listPendingUpdates() {
      return pendingUpdates;
    },
    async enqueuePendingUpdate(
      _execSql,
      pendingUpdate: AddressBookPendingUpdateInsert,
    ) {
      pendingUpdates = [
        ...pendingUpdates,
        {
          id: `pending-${pendingUpdates.length + 1}`,
          partialEndVersionVector: pendingUpdate.partialEndVersionVector,
          partialStartVersionVector: pendingUpdate.partialStartVersionVector,
          updateData: pendingUpdate.updateData,
        },
      ];
    },
    async deletePendingUpdate(_execSql, id) {
      pendingUpdates = pendingUpdates.filter(
        (pendingUpdate) => pendingUpdate.id !== id,
      );
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
      createDocument: async () => null,
      syncDocument: async () => null,
    },
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
      createDocument: async () => ({
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
        userId: "peer-user-1",
      },
    ],
    ready: true,
  });
  expect(persistence.getState().record).not.toBeNull();
  expect(persistence.getState().pendingUpdates).toHaveLength(1);

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
        userId: "peer-user-1",
      },
    ],
    ready: true,
  });

  await secondStore.removeKey("peer-user-1");

  expect(persistence.getState().pendingUpdates).toHaveLength(2);

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

test("contacts store creates and syncs an address book document", async () => {
  const persistence = createContactsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const createDocumentCalls: string[] = [];
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
      createDocument: async () => {
        createDocumentCalls.push("called");
        return runtime.apiClient.createDocument();
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
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().record?.documentId === "contacts-document-1",
    "Contacts document was not synced.",
  );

  expect(syncDocumentCalls).toEqual([
    {
      accessEpoch: 1,
      documentId: "contacts-document-1",
      outgoingUpdateCount: 1,
    },
  ]);
});
