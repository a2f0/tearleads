import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates } from "@tearleads/loro";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type {
  ExplorerPersistence,
  StoredExplorerContainer,
} from "../../data/persistence/explorer/explorerPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { loadLocalExplorerContainerStates } from "./localState";
import { createExplorerWorkflowSqlRuntime } from "./runtime";

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

function createExplorerPersistence(input: {
  savedContainers?: Array<{
    container: ContainerRecord;
    execSql: ExecSql;
    record: DocumentRecord | null;
  }>;
  pendingUpdates?: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }>;
  storedContainers: ReadonlyArray<StoredExplorerContainer>;
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
    async recordCreateIntentError() {},
    async reassignContainerDocuments() {},
    async loadContainers() {
      return input.storedContainers;
    },
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
    async markCreateIntentSynced() {},
  };
}

test("loadLocalExplorerContainerStates materializes metadata records and pending updates", async () => {
  const container = createContainerRecord({
    icon: "folder",
    id: "container-1",
    name: "Local folder",
    parentId: null,
  });
  const savedContainers: Array<{
    container: ContainerRecord;
    execSql: ExecSql;
    record: DocumentRecord | null;
  }> = [];
  const pendingUpdates: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }> = [];

  const [containerState] = await loadLocalExplorerContainerStates({
    persistence: createExplorerPersistence({
      pendingUpdates,
      savedContainers,
      storedContainers: [{ container, record: null }],
    }),
    runtime,
  });
  if (!containerState) {
    throw new Error("Expected container state to be loaded");
  }

  expect(containerState.container).toEqual(container);
  expect(containerState.record).toMatchObject({
    accessEpoch: 1,
    accessStateHash: null,
    documentId: null,
    id: container.id,
    lastCommitLsn: null,
  });
  expect(
    readContainerMetadataValue(
      containerState.doc,
      getDefaultContainerName(container.parentId),
    ),
  ).toEqual({
    icon: "folder",
    name: "Local folder",
  });
  expect(savedContainers).toEqual([
    {
      container,
      execSql,
      record: containerState.record,
    },
  ]);
  expect(pendingUpdates).toHaveLength(1);
  expect(pendingUpdates[0]?.execSql).toBe(execSql);
  expect(pendingUpdates[0]?.input.containerId).toBe(container.id);
});

test("loadLocalExplorerContainerStates replays metadata snapshots into containers", async () => {
  const container = createContainerRecord({
    icon: null,
    id: "container-2",
    metadataDocumentId: "metadata-document-2",
    name: "Stale name",
    parentId: "parent-1",
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, {
    icon: "briefcase",
    name: "Snapshot name",
  });
  const record: DocumentRecord = {
    accessEpoch: 7,
    accessStateHash: "access-hash",
    documentId: container.metadataDocumentId,
    id: container.id,
    lastCommitLsn: "commit-1",
    loroSnapshot: bytesToBase64(exportAllUpdates(doc)),
    contentKeyBundle: "content-key-bundle",
    documentKekTargets: "document-kek-targets",
    documentManifestBundle: "document-manifest-bundle",
  };
  const savedContainers: Array<{
    container: ContainerRecord;
    execSql: ExecSql;
    record: DocumentRecord | null;
  }> = [];
  const pendingUpdates: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }> = [];

  const [containerState] = await loadLocalExplorerContainerStates({
    persistence: createExplorerPersistence({
      pendingUpdates,
      savedContainers,
      storedContainers: [{ container, record }],
    }),
    runtime,
  });
  if (!containerState) {
    throw new Error("Expected container state to be loaded");
  }

  expect(containerState.container).toEqual({
    ...container,
    icon: "briefcase",
    name: "Snapshot name",
  });
  expect(containerState.record).toBe(record);
  expect(savedContainers).toEqual([
    {
      container: containerState.container,
      execSql,
      record,
    },
  ]);
  expect(pendingUpdates).toEqual([]);
});
