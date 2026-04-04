import {
  type ContainerRecord,
  deleteContainer as deleteContainerRecord,
  ensureContainerTables,
  loadContainers as loadContainerRecords,
  saveContainer as saveContainerRecord,
} from "../../data/containerPersistence";
import {
  type DocumentRecord,
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  loadDocumentRecord,
  type PendingUpdateFields,
  type PendingUpdateRecord,
  saveDocumentRecord,
} from "../../data/documentPersistence";
import { type ExecSql, runSerializedSqlMutation } from "../../data/sqlSchema";

const CONTAINER_METADATA_APP_KIND = "container-metadata";

export interface StoredExplorerContainer {
  container: ContainerRecord;
  record: DocumentRecord | null;
}

export interface ExplorerPersistence {
  deleteContainer: (execSql: ExecSql, containerId: string) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    input: PendingUpdateFields & { containerId: string },
  ) => Promise<void>;
  listPendingUpdates: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<PendingUpdateRecord[]>;
  loadContainers: (
    execSql: ExecSql,
  ) => Promise<ReadonlyArray<StoredExplorerContainer>>;
  saveContainer: (
    execSql: ExecSql,
    container: ContainerRecord,
    record: DocumentRecord | null,
  ) => Promise<void>;
}

function getContainerMetadataScope(containerId: string) {
  return {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
  };
}

export const sqlExplorerPersistence: ExplorerPersistence = {
  async deleteContainer(execSql, containerId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteContainerRecord(lockedExecSql, containerId);
      await deleteDocumentRecord(
        lockedExecSql,
        getContainerMetadataScope(containerId),
      );
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getContainerMetadataScope(containerId),
      );
    });
  },
  async deletePendingUpdate(execSql, id) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdate(lockedExecSql, id);
    });
  },
  async ensureSchema(execSql) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureContainerTables(lockedExecSql);
      await ensureDocumentTables(lockedExecSql);
    });
  },
  async enqueuePendingUpdate(execSql, input) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await enqueueDocumentPendingUpdate(
        lockedExecSql,
        getContainerMetadataScope(input.containerId),
        input,
      );
    });
  },
  async listPendingUpdates(execSql, containerId) {
    return listDocumentPendingUpdates(
      execSql,
      getContainerMetadataScope(containerId),
    );
  },
  async loadContainers(execSql) {
    const containers = await loadContainerRecords(execSql);
    const storedContainers = await Promise.all(
      containers.map(async (container) => ({
        container,
        record: await loadDocumentRecord(
          execSql,
          getContainerMetadataScope(container.id),
        ),
      })),
    );

    return storedContainers;
  },
  async saveContainer(execSql, container, record) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await saveContainerRecord(lockedExecSql, container);

      if (!record) {
        return;
      }

      await saveDocumentRecord(
        lockedExecSql,
        getContainerMetadataScope(container.id),
        {
          ...record,
          id: container.id,
        },
        new Date().toISOString(),
      );
    });
  },
};
