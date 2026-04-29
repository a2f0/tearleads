import { expect, test } from "bun:test";
import {
  type AccessEventV2,
  computeAccessEventHash,
  computeWriteHeaderHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  type WriteHeaderV2,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  DocumentV2CreateRequest,
  DocumentV2SyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerV2WriterProjectionResponse,
  DocumentV2CreateResponse,
  DocumentV2SyncResponse,
} from "@tearleads/validators/response";
import { createMockApiClient } from "../../../../test/helpers/createMockApiClient";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../../data/persistence/documentPersistence";
import type {
  ContactPendingUpdateInsert,
  ContactsPersistence,
} from "../contactsPersistence";
import { type ContactsRuntime, createContactsStore } from "./ContactsProvider";

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
): ContactsRuntime["apiClient"] {
  return createMockApiClient({
    createDocumentV2: async () => null,
    getContainerV2WriterProjection: async () => null,
    getDocumentV2WriterProjection: async () => null,
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
    syncDocumentV2: async () => null,
  });
}

async function contactV2FixtureHash(label: string): Promise<string> {
  return toFingerprint(new TextEncoder().encode(`contacts-v2:${label}`));
}

async function createContactV2ContainerProjection(input: {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  userId: string;
}): Promise<ContainerV2WriterProjectionResponse> {
  const manifestHash = await contactV2FixtureHash(
    `${input.containerId}:manifest`,
  );
  const eventHash = await contactV2FixtureHash(`${input.containerId}:event`);
  const keyEpochHash = await contactV2FixtureHash(
    `${input.containerId}:key-epoch`,
  );
  const keyTargetHash = await contactV2FixtureHash(
    `${input.containerId}:key-target`,
  );
  const containerKeyEpochId = `${input.containerId}-key-epoch-1`;
  const containerKek = crypto.getRandomValues(new Uint8Array(32));
  const [recipient] = await wrapDekForRecipients(containerKek, [
    input.encapsulationPublicKey,
  ]);
  if (!recipient) {
    throw new Error("Expected V2 contact fixture recipient wrap.");
  }

  return {
    containerId: input.containerId,
    organizationId: "organization-1",
    path: [
      {
        event: { event: {}, body: {}, eventHash },
        manifest: {},
        manifestHash,
        state: {
          containerId: input.containerId,
          organizationId: "organization-1",
        },
      },
    ],
    containerKeks: [
      {
        containerId: input.containerId,
        accessManifestHash: manifestHash,
        containerKeyEpochId,
        containerKeyEpoch: 1,
        keyEpoch: {
          id: containerKeyEpochId,
          containerId: input.containerId,
          keyEpoch: 1,
          accessManifestHash: manifestHash,
          parentContainerKeyEpochId: null,
          createdByEventHash: eventHash,
          createdByManifestHash: manifestHash,
        },
        keyEpochHash,
        keyTargetHash,
        parentContainerKeyEpochId: null,
        recipientTargets: [{}],
        wraps: [
          {
            containerKeyEpochId,
            recipientKind: "user",
            recipientId: input.userId,
            recipientKeyEpochId: `user:${input.userId}:epoch-1`,
            recipientKeyFingerprint: recipient.keyFingerprint,
            kemCipherText: bytesToBase64(recipient.kemCipherText),
            wrappedKey: bytesToBase64(recipient.wrappedKey),
            wrapManifestHash: manifestHash,
          },
        ],
      },
    ],
  };
}

async function createContactV2CreateResponse(
  request: DocumentV2CreateRequest,
): Promise<DocumentV2CreateResponse> {
  const manifest = request.manifest as Record<string, unknown>;
  const body = request.body as Record<string, unknown>;
  const documentId = String(Reflect.get(manifest, "objectId"));
  const eventHash = await computeAccessEventHash(
    request.event as unknown as AccessEventV2,
  );
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
      event: { event: request.event, body, eventHash },
      manifest,
      manifestHash: request.expectedManifestHash,
      state: {
        version: 2,
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

async function createContactV2SyncResponse(input: {
  request: DocumentV2SyncRequest;
  storedDocument: DocumentV2CreateResponse;
  commitLsn: string;
}): Promise<DocumentV2SyncResponse> {
  const updates = await Promise.all(
    input.request.outgoingUpdates.map(async (update) => {
      const writeHeader = update.writeHeader as unknown as WriteHeaderV2;
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

interface ContactV2RuntimePatch {
  apiClient: ContactsRuntime["apiClient"];
  organizationId: string;
  signingFingerprint: string;
  signingKeyPair: NonNullable<ContactsRuntime["signingKeyPair"]>;
  userId: string;
}

async function createContactV2RuntimePatch(input: {
  containerId?: string;
  createCalls?: Array<{ linkedContainerIds: string[] }>;
  encapsulationKeyPair: NonNullable<ContactsRuntime["encapsulationKeyPair"]>;
  syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
}): Promise<ContactV2RuntimePatch> {
  const containerId = input.containerId ?? "root-container";
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  let projectionPromise: Promise<ContainerV2WriterProjectionResponse> | null =
    null;
  let storedDocument: DocumentV2CreateResponse | null = null;
  let syncCount = 0;
  const getProjection = () => {
    projectionPromise ??= createContactV2ContainerProjection({
      containerId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
      userId: "user-1",
    });
    return projectionPromise;
  };

  return {
    apiClient: createMockApiClient({
      getEncapsulationKey: async (userId: string) => ({
        encapsulationPublicKey: `${userId}-key`,
        signingKeyFingerprint: `${userId}-signing-fingerprint`,
        signingPublicKey: `${userId}-signing-key`,
        userId,
      }),
      createDocumentV2: async (request) => {
        input.createCalls?.push({
          linkedContainerIds: request.contentKeyBundle.targets.map(
            (target) => target.containerId,
          ),
        });
        storedDocument = await createContactV2CreateResponse(request);
        return storedDocument;
      },
      getContainerV2WriterProjection: () => getProjection(),
      getDocumentV2WriterProjection: async () => {
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
      syncDocumentV2: async (_documentId, request) => {
        if (!storedDocument) {
          return null;
        }
        input.syncCalls?.push({
          minLsn: request.minLsn ?? null,
          outgoingUpdateCount: request.outgoingUpdates.length,
        });
        syncCount += 1;
        return createContactV2SyncResponse({
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
    apiClient: createUnavailableContactsApiClient(userIdToImport),
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

async function createSyncRuntime(
  encapsulationKeyPair: NonNullable<ContactsRuntime["encapsulationKeyPair"]>,
  options: {
    createCalls?: Array<{ linkedContainerIds: string[] }>;
    syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
  } = {},
): Promise<ContactsRuntime> {
  const v2Patch = await createContactV2RuntimePatch({
    encapsulationKeyPair,
    ...(options.createCalls ? { createCalls: options.createCalls } : {}),
    ...(options.syncCalls ? { syncCalls: options.syncCalls } : {}),
  });
  return {
    apiClient: v2Patch.apiClient,
    containerId: "root-container",
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair,
    events: [],
    execSql: async () => [],
    isAuthenticated: true,
    log: () => {},
    online: true,
    organizationId: v2Patch.organizationId,
    signingFingerprint: v2Patch.signingFingerprint,
    signingKeyPair: v2Patch.signingKeyPair,
    userId: v2Patch.userId,
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

test("contacts store creates and syncs a contact document through V2", async () => {
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
    "Contact document was not synced through V2.",
  );

  const record = persistence.getContact("peer-user-1")?.record;
  expect(createCalls).toEqual([{ linkedContainerIds: ["root-container"] }]);
  expect(syncCalls).toEqual([{ minLsn: null, outgoingUpdateCount: 1 }]);
  expect(record?.v2ContentKeyBundle).toBeString();
  expect(record?.v2DocumentKekTargets).toBeString();
  expect(record?.v2DocumentManifestBundle).toBeString();
});

test("contacts store keeps contact updates on V2 without recipient fanout", async () => {
  const persistence = createContactsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const createCalls: Array<{ linkedContainerIds: string[] }> = [];
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  let importedEncapsulationPublicKey = "peer-user-1-key";
  const runtime = await createSyncRuntime(encapsulationKeyPair, {
    createCalls,
    syncCalls,
  });
  const instrumentedRuntime: ContactsRuntime = {
    ...runtime,
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      getEncapsulationKey: async (userId: string) => ({
        encapsulationPublicKey: importedEncapsulationPublicKey,
        signingKeyFingerprint: `${userId}-signing-fingerprint`,
        signingPublicKey: `${userId}-signing-key`,
        userId,
      }),
    }),
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
      createCalls.length === 1 &&
      syncCalls.length === 1 &&
      persistence.getPendingUpdates("peer-user-1").length === 0,
    "Initial contact V2 sync did not complete.",
  );

  importedEncapsulationPublicKey = "peer-user-1-key-2";
  await store.importKey("peer-user-1");

  await waitForCondition(
    () =>
      createCalls.length === 1 &&
      syncCalls.length === 2 &&
      persistence.getPendingUpdates("peer-user-1").length === 0,
    "Follow-up contact V2 sync did not complete.",
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
  const runtime = await createSyncRuntime(encapsulationKeyPair, { syncCalls });
  const instrumentedRuntime: ContactsRuntime = {
    ...runtime,
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      getEncapsulationKey: async (userId: string) => ({
        encapsulationPublicKey: importedEncapsulationPublicKey,
        signingKeyFingerprint: `${userId}-signing-fingerprint`,
        signingPublicKey: `${userId}-signing-key`,
        userId,
      }),
    }),
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
