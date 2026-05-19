import { expect, test } from "bun:test";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "@tearleads/client-sdk/data/containers/containerMetadataDocument";
import type { ExecSql } from "@tearleads/client-sdk/data/sqlite/sqlSchema";
import {
  type ContainerRecord,
  type ExplorerDocumentRecord,
  type ExplorerPersistence,
  hasExplorerMetadataDocumentUpdateEvent,
  persistExplorerContainerMetadataStateFromRuntime,
  renameExplorerContainerMetadataStateFromRuntime,
} from "@tearleads/client-sdk/workflows/explorer/index";
import { createExplorerWorkflowSqlRuntime } from "@tearleads/client-sdk/workflows/explorer/runtime";

const execSql: ExecSql = async () => [];
const runtime = createExplorerWorkflowSqlRuntime({ execSql });

type PendingUpdateInput = Parameters<
  ExplorerPersistence["enqueuePendingUpdate"]
>[1];

function createContainerRecord(
  input: Partial<ContainerRecord> & Pick<ContainerRecord, "id" | "parentId">,
): ContainerRecord {
  return {
    icon: null,
    metadataDocumentId: null,
    name: "Stored container",
    organizationId: "org-1",
    ...input,
  };
}

function createDocumentRecord(
  input: Partial<ExplorerDocumentRecord> & Pick<ExplorerDocumentRecord, "id">,
): ExplorerDocumentRecord {
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

function createExplorerPersistence(input: {
  pendingUpdates?: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }>;
  savedContainers?: Array<{
    container: ContainerRecord;
    execSql: ExecSql;
    record: ExplorerDocumentRecord | null;
  }>;
}): ExplorerPersistence {
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
    async listPendingUpdates() {
      return [];
    },
    async loadContainers() {
      return [];
    },
    async markCreateIntentSynced() {},
    async recordCreateIntentError() {},
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

test("persistExplorerContainerMetadataStateFromRuntime uses the runtime executor", async () => {
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
    record: ExplorerDocumentRecord | null;
  }> = [];

  const persisted = await persistExplorerContainerMetadataStateFromRuntime({
    metadataState: { container, doc, record },
    persistence: createExplorerPersistence({ savedContainers }),
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

test("renameExplorerContainerMetadataStateFromRuntime queues metadata update with the runtime executor", async () => {
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
    record: ExplorerDocumentRecord | null;
  }> = [];

  const renamed = await renameExplorerContainerMetadataStateFromRuntime({
    metadataState: { container, doc, record },
    name: "New name",
    persistence: createExplorerPersistence({
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

test("hasExplorerMetadataDocumentUpdateEvent detects known metadata document updates", () => {
  const metadataState = {
    record: createDocumentRecord({
      documentId: "metadata-document-1",
      id: "container-1",
    }),
  };

  expect(
    hasExplorerMetadataDocumentUpdateEvent(
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
    hasExplorerMetadataDocumentUpdateEvent(
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
    hasExplorerMetadataDocumentUpdateEvent(
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

test("hasExplorerMetadataDocumentUpdateEvent ignores containers without metadata document ids", () => {
  const metadataState = {
    record: createDocumentRecord({
      id: "container-1",
    }),
  };

  expect(
    hasExplorerMetadataDocumentUpdateEvent(
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
