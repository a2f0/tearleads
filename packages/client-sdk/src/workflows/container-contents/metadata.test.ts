import { expect, test } from "bun:test";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { DocumentRecord as ContainerDocumentRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  hasContainerMetadataDocumentUpdateEvent,
  listContainerMetadataDocumentUpdateIds,
  persistContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime,
  syncContainerMetadataState,
} from "./metadata";

const execSql: ExecSql = async () => [];
const runtime = { infra: { execSql } };

type PendingUpdateInput = Parameters<
  ContainerContentsPersistence["enqueuePendingUpdate"]
>[1];

function createContainerRecord(
  input: Partial<ContainerRecord> & Pick<ContainerRecord, "id" | "parentId">,
): ContainerRecord {
  return {
    effectiveAccessLevel: "admin",
    icon: null,
    metadataDocumentId: null,
    name: "Stored container",
    organizationId: "org-1",
    ...input,
  };
}

function createDocumentRecord(
  input: Partial<ContainerDocumentRecord> & Pick<ContainerDocumentRecord, "id">,
): ContainerDocumentRecord {
  return {
    accessEpoch: 1,
    accessStateHash: null,
    contentKeyBundle: null,
    documentId: null,
    documentKekTargets: null,
    documentManifestBundle: null,
    lastCommitLsn: null,
    loroSnapshot: "",
    ...input,
  };
}

function createContainerContentsPersistence(input: {
  pendingUpdates?: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }>;
  savedContainers?: Array<{
    container: ContainerRecord;
    execSql: ExecSql;
    record: ContainerDocumentRecord | null;
  }>;
}): ContainerContentsPersistence {
  return {
    async deleteContainer() {},
    async deleteContainers() {},
    async deletePendingUpdates() {},
    async ensureSchema() {},
    async enqueuePendingUpdate(receivedExecSql, pendingUpdate) {
      input.pendingUpdates?.push({
        execSql: receivedExecSql,
        input: pendingUpdate,
      });
    },
    async listPendingCreateIntents() {
      return [];
    },
    async listPendingMoveIntents() {
      return [];
    },
    async listUnsyncedMoveIntents() {
      return [];
    },
    async listContainerIdsWithPendingUpdates() {
      return [];
    },
    async listPendingUpdates() {
      return [];
    },
    async loadContainers() {
      return [];
    },
    async markCreateIntentSynced() {},
    async markMoveIntentSynced() {},
    async recordCreateIntentError() {},
    async recordMoveIntentError() {},
    async reassignContainerDocuments() {},
    async reconcileLocalRootContainer() {},
    async reconcileLocalSystemContainer() {},
    async saveContainer(receivedExecSql, container, record) {
      input.savedContainers?.push({
        container,
        execSql: receivedExecSql,
        record,
      });
      return container;
    },
    async saveContainerAndDeletePendingUpdates(_execSql, container) {
      return container;
    },
  };
}

test("persistContainerMetadataStateFromRuntime uses the runtime executor", async () => {
  const container = createContainerRecord({
    id: "container-1",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, {
    icon: "folder",
    name: "Runtime container",
  });
  const record = createDocumentRecord({ id: container.id });
  const savedContainers: Array<{
    container: ContainerRecord;
    execSql: ExecSql;
    record: ContainerDocumentRecord | null;
  }> = [];

  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: { container, doc, record },
    persistence: createContainerContentsPersistence({ savedContainers }),
    runtime,
  });

  expect(savedContainers).toEqual([
    {
      container: persisted.container,
      execSql,
      record: persisted.record,
    },
  ]);
  expect(persisted.container).toMatchObject({
    icon: "folder",
    name: "Runtime container",
  });
});

test("renameContainerMetadataStateFromRuntime queues metadata update with the runtime executor", async () => {
  const container = createContainerRecord({
    id: "container-2",
    parentId: "parent-1",
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, {
    icon: "briefcase",
    name: "Old name",
  });
  const record = createDocumentRecord({ id: container.id });
  const pendingUpdates: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }> = [];
  const savedContainers: Array<{
    container: ContainerRecord;
    execSql: ExecSql;
    record: ContainerDocumentRecord | null;
  }> = [];

  const renamed = await renameContainerMetadataStateFromRuntime({
    metadataState: { container, doc, record },
    name: "New name",
    persistence: createContainerContentsPersistence({
      pendingUpdates,
      savedContainers,
    }),
    runtime,
  });

  expect(renamed?.container.name).toBe("New name");
  expect(readContainerMetadataValue(doc, "Stored container")).toMatchObject({
    icon: "briefcase",
    name: "New name",
  });
  expect(pendingUpdates).toHaveLength(1);
  expect(pendingUpdates[0]?.execSql).toBe(execSql);
  expect(pendingUpdates[0]?.input.containerId).toBe(container.id);
  expect(savedContainers).toHaveLength(1);
  expect(savedContainers[0]?.execSql).toBe(execSql);
});

test("hasContainerMetadataDocumentUpdateEvent detects known metadata document updates", () => {
  const metadataState = {
    record: createDocumentRecord({
      documentId: "metadata-document-1",
      id: "container-1",
    }),
  };

  expect(
    listContainerMetadataDocumentUpdateIds(
      [
        {
          documentId: "metadata-document-1",
          id: "event-1",
          type: "document_update_created",
        },
      ],
      [metadataState],
    ),
  ).toEqual(["metadata-document-1"]);
  expect(
    hasContainerMetadataDocumentUpdateEvent(
      [
        {
          documentId: "metadata-document-1",
          id: "event-1",
          type: "document_update_created",
        },
      ],
      [metadataState],
    ),
  ).toBe(true);
  expect(
    hasContainerMetadataDocumentUpdateEvent(
      [
        {
          documentId: "other-document",
          id: "event-2",
          type: "document_update_created",
        },
      ],
      [metadataState],
    ),
  ).toBe(false);
  expect(
    hasContainerMetadataDocumentUpdateEvent(
      [
        {
          documentId: "metadata-document-1",
          id: "event-3",
          type: "other_event",
        },
      ],
      [metadataState],
    ),
  ).toBe(false);
});

test("syncContainerMetadataState skips clean metadata with current read state", async () => {
  let listPendingUpdateCalls = 0;
  let writerProjectionCalls = 0;
  const container = createContainerRecord({
    id: "container-3",
    metadataDocumentId: "metadata-document-3",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  const record = createDocumentRecord({
    contentKeyBundle: "content-key-bundle",
    documentId: "metadata-document-3",
    documentKekTargets: "document-kek-targets",
    documentManifestBundle: "document-manifest-bundle",
    id: container.id,
    lastCommitLsn: "0/1",
  });
  const persistence = createContainerContentsPersistence({});

  const synced = await syncContainerMetadataState({
    metadataState: { container, doc, record },
    persistence: {
      ...persistence,
      async listPendingUpdates() {
        listPendingUpdateCalls += 1;
        return [];
      },
    },
    resolveProjectionUserKey: async () => {
      throw new Error("resolveProjectionUserKey should not be called.");
    },
    runtime: {
      apiClient: {
        getDocumentWriterProjection: async () => {
          writerProjectionCalls += 1;
          throw new Error("metadata writer projection should not be loaded.");
        },
      },
      auth: {
        deviceId: "device-1",
        organizationId: "org-1",
        userId: "user-1",
      },
      crypto: {
        encapsulationKeyPair: null,
        signingKeyPair: null,
        signingFingerprint: null,
      },
      infra: { execSql },
      state: {
        containerId: null,
        domainScope: {},
        events: [],
        online: true,
      },
      util: {
        log: () => undefined,
      },
    } as never,
    targetSecretKey: new Uint8Array(),
  });

  expect(synced).toBeNull();
  expect(listPendingUpdateCalls).toBe(1);
  expect(writerProjectionCalls).toBe(0);
});

test("hasContainerMetadataDocumentUpdateEvent ignores containers without metadata document ids", () => {
  const metadataState = {
    record: createDocumentRecord({
      id: "container-1",
    }),
  };

  expect(
    hasContainerMetadataDocumentUpdateEvent(
      [
        {
          documentId: "metadata-document-1",
          id: "event-1",
          type: "document_update_created",
        },
      ],
      [metadataState],
    ),
  ).toBe(false);
});
