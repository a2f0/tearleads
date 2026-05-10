import { expect, test } from "bun:test";
import {
  computeAccessEventHash,
  computeWriteHeaderHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  DocumentCreateRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentSyncResponse,
} from "@tearleads/validators/response";
import { createContainerWriterProjectionFixture } from "../../../test/helpers/createContainerWriterProjectionFixture";
import { createMockApiClient } from "../../../test/helpers/createMockApiClient";
import {
  assertAccessEvent,
  assertWriteHeader,
} from "../../../test/helpers/keyingAssertions";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import type {
  ContactPendingUpdateInsert,
  ContactsPersistence,
} from "../../data/persistence/contacts/contactsPersistence";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/sqlite/documentPersistence";
import { createContactsWorkflowRuntime } from "../../workflows/contacts";
import { type ContactsRuntime, createContactsStore } from "./ContactsProvider";

type ContactsRuntimeInput = Parameters<typeof createContactsWorkflowRuntime>[0];

interface StoredContactState {
  entry: {
    encapsulationPublicKey: string;
    isSelf: boolean;
    userId: string;
  };
  record: DocumentRecord | null;
}

function createUnavailableContactsApiClient(
  userIdToImport?: string,
): ContactsRuntimeInput["apiClient"] {
  return createMockApiClient({
    createDocument: async () => null,
    getContainerWriterProjection: async () => null,
    getDocumentWriterProjection: async () => null,
    getEncapsulationKey: async (userId: string) => {
      if (userId !== userIdToImport) {
        return null;
      }

      return {
        encapsulationPublicKey: `${userId}-key`,
        signingKeyFingerprint: `${userId}-signing-fingerprint`,
        signingPublicKey: `${userId}-signing-key`,
        userId,
      };
    },
    syncDocument: async () => null,
  });
}

async function createContactContainerProjection(input: {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  return createContainerWriterProjectionFixture({
    containerId: input.containerId,
    encapsulationPublicKey: input.encapsulationPublicKey,
    organizationId: "organization-1",
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signerPrivateKey,
    userId: input.userId,
  });
}

async function createContactCreateResponse(
  request: DocumentCreateRequest,
): Promise<DocumentCreateResponse> {
  const manifest = request.manifest as Record<string, unknown>;
  const body = request.body as Record<string, unknown>;
  const documentId = String(Reflect.get(manifest, "objectId"));
  const event = assertAccessEvent(request.event, "document create event");
  const eventHash = await computeAccessEventHash(event);
  const linkedContainerId = String(Reflect.get(body, "containerId"));
  const targets = request.contentKeyBundle.targets.map((target) => ({
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
  }));

  return {
    id: documentId,
    createdAt: "2026-04-27T00:00:00.000Z",
    accessManifest: {
      event: { event: { ...event }, body, eventHash },
      manifest,
      manifestHash: request.expectedManifestHash,
      state: {
        version: 1,
        documentId,
        organizationId: String(Reflect.get(manifest, "organizationId")),
        epoch: Number(Reflect.get(manifest, "epoch")),
        previousManifestHash: Reflect.get(manifest, "previousManifestHash"),
        eventHash,
        linkedContainerIds: [linkedContainerId],
      },
    },
    contentKeyBundle: {
      documentId,
      contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: request.contentKeyBundle.linkSetManifestHash,
      targetHash: request.contentKeyBundle.targetHash,
      targets: request.contentKeyBundle.targets,
    },
    documentKekTargets: {
      documentId,
      linkSetManifestHash: request.expectedManifestHash,
      linkedContainerManifestHashes: targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets,
      documentKeyTargetHash: request.contentKeyBundle.targetHash,
    },
  };
}

async function createContactSyncResponse(input: {
  request: DocumentSyncRequest;
  storedDocument: DocumentCreateResponse;
  commitLsn: string;
}): Promise<DocumentSyncResponse> {
  const updates = await Promise.all(
    input.request.outgoingUpdates.map(async (update) => {
      const writeHeader = assertWriteHeader(
        update.writeHeader,
        "document sync write header",
      );
      return {
        accessEpoch: 1,
        id: update.id,
        documentId: input.storedDocument.id,
        authorFingerprint: writeHeader.writerKeyFingerprint,
        encryptedData: update.encryptedData,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        createdAt: "2026-04-27T00:00:00.000Z",
        writeHeader: update.writeHeader,
        writeHeaderHash: await computeWriteHeaderHash(writeHeader),
      };
    }),
  );

  return {
    acceptedOutgoingUpdateIds: input.request.outgoingUpdates.map(
      (update) => update.id,
    ),
    commitLsn: input.commitLsn,
    contentKeyBundle: input.storedDocument.contentKeyBundle,
    documentId: input.storedDocument.id,
    documentKekTargets: input.storedDocument.documentKekTargets,
    missingUpdateEpochs: updates.length === 0 ? [] : ["current_epoch"],
    updates,
  };
}

interface ContactRuntimePatch {
  apiClient: ContactsRuntimeInput["apiClient"];
  organizationId: string;
  signingFingerprint: string;
  signingKeyPair: NonNullable<ContactsRuntimeInput["signingKeyPair"]>;
  userId: string;
}

async function createContactRuntimePatch(input: {
  containerId?: string;
  createCalls?: Array<{ linkedContainerIds: string[] }>;
  encapsulationKeyPair: NonNullable<
    ContactsRuntimeInput["encapsulationKeyPair"]
  >;
  syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
}): Promise<ContactRuntimePatch> {
  const containerId = input.containerId ?? "root-container";
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  let projectionPromise: Promise<ContainerWriterProjectionResponse> | null =
    null;
  let storedDocument: DocumentCreateResponse | null = null;
  let syncCount = 0;
  const getProjection = () => {
    projectionPromise ??= createContactContainerProjection({
      containerId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
      signerKeyFingerprint: signingFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      userId: "user-1",
    });
    return projectionPromise;
  };

  return {
    apiClient: createMockApiClient({
      getEncapsulationKey: async (userId: string) =>
        userId === "user-1"
          ? {
              encapsulationPublicKey: bytesToBase64(
                input.encapsulationKeyPair.publicKey,
              ),
              signingKeyFingerprint: signingFingerprint,
              signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
              userId,
            }
          : {
              encapsulationPublicKey: `${userId}-key`,
              signingKeyFingerprint: `${userId}-signing-fingerprint`,
              signingPublicKey: `${userId}-signing-key`,
              userId,
            },
      createDocument: async (request) => {
        input.createCalls?.push({
          linkedContainerIds: request.contentKeyBundle.targets.map(
            (target) => target.containerId,
          ),
        });
        storedDocument = await createContactCreateResponse(request);
        return storedDocument;
      },
      getContainerWriterProjection: () => getProjection(),
      getDocumentWriterProjection: async () => {
        if (!storedDocument) {
          return null;
        }
        return {
          authorizingContainerPaths: [await getProjection()],
          contentKeyBundle: storedDocument.contentKeyBundle,
          documentId: storedDocument.id,
          documentKekTargets: storedDocument.documentKekTargets,
          documentManifest: storedDocument.accessManifest,
        };
      },
      syncDocument: async (_documentId, request) => {
        if (!storedDocument) {
          return null;
        }
        input.syncCalls?.push({
          minLsn: request.minLsn ?? null,
          outgoingUpdateCount: request.outgoingUpdates.length,
        });
        syncCount += 1;
        return createContactSyncResponse({
          request,
          storedDocument,
          commitLsn: syncCount === 1 ? "0/10" : "0/20",
        });
      },
    }),
    organizationId: "organization-1",
    signingFingerprint,
    signingKeyPair,
    userId: "user-1",
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

  const saveContact = (
    nextRecord: DocumentRecord,
    entry: StoredContactState["entry"],
  ) => {
    contacts.set(entry.userId, {
      entry: { ...entry },
      record: nextRecord,
    });
  };

  const deletePendingUpdateIds = (ids: ReadonlySet<string>) => {
    for (const [userId, pendingUpdates] of pendingUpdatesByUserId) {
      const nextPendingUpdates = pendingUpdates.filter(
        (pendingUpdate) => !ids.has(pendingUpdate.id),
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
  };

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
      saveContact(nextRecord, entry);
    },
    async saveContactAndDeletePendingUpdates(
      _execSql,
      _addressBookId,
      nextRecord,
      entry,
      pendingUpdateIds,
    ) {
      deletePendingUpdateIds(new Set(pendingUpdateIds));
      saveContact(nextRecord, entry);
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
        id: crypto.randomUUID(),
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
    async deletePendingUpdates(_execSql, userId) {
      pendingUpdatesByUserId.delete(userId);
    },
  };
}

function createRuntime(userIdToImport?: string): ContactsRuntime {
  return createContactsWorkflowRuntime({
    apiClient: createUnavailableContactsApiClient(userIdToImport),
    containerId: "root-container",
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair: null,
    events: [],
    execSql: async () => [],
    isAuthenticated: false,
    log: () => {},
    logError: () => {},
    online: false,
  });
}

async function createSyncRuntimeInput(
  encapsulationKeyPair: NonNullable<
    ContactsRuntimeInput["encapsulationKeyPair"]
  >,
  options: {
    createCalls?: Array<{ linkedContainerIds: string[] }>;
    syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
  } = {},
): Promise<ContactsRuntimeInput> {
  const patch = await createContactRuntimePatch({
    encapsulationKeyPair,
    ...(options.createCalls ? { createCalls: options.createCalls } : {}),
    ...(options.syncCalls ? { syncCalls: options.syncCalls } : {}),
  });
  return {
    apiClient: patch.apiClient,
    containerId: "root-container",
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair,
    events: [],
    execSql: async () => [],
    isAuthenticated: true,
    log: () => {},
    logError: () => {},
    online: true,
    organizationId: patch.organizationId,
    signingFingerprint: patch.signingFingerprint,
    signingKeyPair: patch.signingKeyPair,
    userId: patch.userId,
  };
}

async function createSyncRuntime(
  encapsulationKeyPair: NonNullable<
    ContactsRuntimeInput["encapsulationKeyPair"]
  >,
  options: {
    createCalls?: Array<{ linkedContainerIds: string[] }>;
    syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
  } = {},
): Promise<ContactsRuntime> {
  return createContactsWorkflowRuntime(
    await createSyncRuntimeInput(encapsulationKeyPair, options),
  );
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
  const createCalls: Array<{ linkedContainerIds: string[] }> = [];
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime = await createSyncRuntime(encapsulationKeyPair, {
    createCalls,
    syncCalls,
  });
  const store = createContactsStore(runtime, persistence);

  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Contacts sync store did not become ready.",
  );

  await store.importKey("peer-user-1");

  await waitForCondition(
    () =>
      createCalls.length === 1 &&
      syncCalls.length === 1 &&
      persistence.getPendingUpdates("peer-user-1").length === 0 &&
      typeof persistence.getContact("peer-user-1")?.record?.documentId ===
        "string",
    "Contact document was not synced.",
  );

  const record = persistence.getContact("peer-user-1")?.record;
  expect(createCalls).toEqual([{ linkedContainerIds: ["root-container"] }]);
  expect(syncCalls).toEqual([{ minLsn: null, outgoingUpdateCount: 1 }]);
  expect(record?.contentKeyBundle).toBeString();
  expect(record?.documentKekTargets).toBeString();
  expect(record?.documentManifestBundle).toBeString();
});

test("contacts store keeps contact updates without recipient fanout", async () => {
  const persistence = createContactsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const createCalls: Array<{ linkedContainerIds: string[] }> = [];
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  let importedEncapsulationPublicKey = "peer-user-1-key";
  const runtimeInput = await createSyncRuntimeInput(encapsulationKeyPair, {
    createCalls,
    syncCalls,
  });
  const instrumentedRuntime = createContactsWorkflowRuntime({
    ...runtimeInput,
    apiClient: {
      ...runtimeInput.apiClient,
      getEncapsulationKey: async (userId: string) => ({
        encapsulationPublicKey: importedEncapsulationPublicKey,
        signingKeyFingerprint: `${userId}-signing-fingerprint`,
        signingPublicKey: `${userId}-signing-key`,
        userId,
      }),
    },
  });
  const store = createContactsStore(instrumentedRuntime, persistence);

  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Contacts sync store did not become ready.",
  );

  await store.importKey("peer-user-1");
  await waitForCondition(
    () =>
      createCalls.length === 1 &&
      syncCalls.length === 1 &&
      persistence.getPendingUpdates("peer-user-1").length === 0,
    "Initial contact sync did not complete.",
  );

  importedEncapsulationPublicKey = "peer-user-1-key-2";
  await store.importKey("peer-user-1");

  await waitForCondition(
    () =>
      createCalls.length === 1 &&
      syncCalls.length === 2 &&
      persistence.getPendingUpdates("peer-user-1").length === 0,
    "Follow-up contact sync did not complete.",
  );

  expect(syncCalls).toEqual([
    { minLsn: null, outgoingUpdateCount: 1 },
    { minLsn: "0/10", outgoingUpdateCount: 1 },
  ]);
  expect(persistence.getContact("peer-user-1")?.record).toMatchObject({
    lastCommitLsn: "0/20",
  });
});

test("contacts store persists commitLsn and reuses it as minLsn on the next sync", async () => {
  const persistence = createContactsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  let importedEncapsulationPublicKey = "peer-user-1-key";
  const runtimeInput = await createSyncRuntimeInput(encapsulationKeyPair, {
    syncCalls,
  });
  const instrumentedRuntime = createContactsWorkflowRuntime({
    ...runtimeInput,
    apiClient: {
      ...runtimeInput.apiClient,
      getEncapsulationKey: async (userId: string) => ({
        encapsulationPublicKey: importedEncapsulationPublicKey,
        signingKeyFingerprint: `${userId}-signing-fingerprint`,
        signingPublicKey: `${userId}-signing-key`,
        userId,
      }),
    },
  });
  const store = createContactsStore(instrumentedRuntime, persistence);

  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Contacts sync store did not become ready.",
  );

  await store.importKey("peer-user-1");

  await waitForCondition(
    () =>
      syncCalls.length === 1 &&
      persistence.getPendingUpdates("peer-user-1").length === 0 &&
      persistence.getContact("peer-user-1")?.record?.lastCommitLsn === "0/10",
    "Initial contact document sync did not persist the returned commitLsn.",
  );

  importedEncapsulationPublicKey = "peer-user-1-key-2";
  await store.importKey("peer-user-1");

  await waitForCondition(
    () =>
      syncCalls.length === 2 &&
      persistence.getPendingUpdates("peer-user-1").length === 0 &&
      persistence.getContact("peer-user-1")?.record?.lastCommitLsn === "0/20",
    "Follow-up contact sync did not reuse and refresh the persisted commitLsn.",
  );

  expect(syncCalls).toEqual([
    {
      minLsn: null,
      outgoingUpdateCount: 1,
    },
    {
      minLsn: "0/10",
      outgoingUpdateCount: 1,
    },
  ]);
});
