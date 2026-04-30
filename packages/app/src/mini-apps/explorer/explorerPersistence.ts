import {
  type ContainerRecord,
  deleteContainer as deleteContainerRecord,
  ensureContainerTables,
  loadContainers as loadContainerRecords,
} from "../../data/containers";
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
} from "../../data/persistence/documentPersistence";
import {
  type ExecSql,
  readSqlRowValue,
  runSerializedSqlMutation,
  runSqlTransaction,
  type SqlRow,
} from "../../data/persistence/sqlSchema";

const CONTAINER_METADATA_APP_KIND = "container-metadata";
const CONTAINER_CREATE_INTENT_TYPE = "container.create";

export type ContainerCreateIntentSyncStatus = "pending" | "synced";

export interface ContainerCreateIntentRecord {
  id: string;
  containerId: string;
  parentContainerId: string;
  intentType: typeof CONTAINER_CREATE_INTENT_TYPE;
  syncStatus: ContainerCreateIntentSyncStatus;
  remoteContainerId: string | null;
  remoteMetadataDocumentId: string | null;
  remoteMetadataAccessStateHash: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContainerCreateIntentInput {
  id?: string;
  parentContainerId: string;
}

export interface StoredExplorerContainer {
  container: ContainerRecord;
  record: DocumentRecord | null;
}

export interface ExplorerPersistence {
  deleteContainer: (execSql: ExecSql, containerId: string) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
  deletePendingUpdates: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<void>;
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    input: PendingUpdateFields & { containerId: string },
  ) => Promise<void>;
  listPendingCreateIntents: (
    execSql: ExecSql,
  ) => Promise<ContainerCreateIntentRecord[]>;
  listPendingUpdates: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<PendingUpdateRecord[]>;
  recordCreateIntentError: (
    execSql: ExecSql,
    containerId: string,
    message: string,
  ) => Promise<void>;
  loadContainers: (
    execSql: ExecSql,
  ) => Promise<ReadonlyArray<StoredExplorerContainer>>;
  saveContainer: (
    execSql: ExecSql,
    container: ContainerRecord,
    record: DocumentRecord | null,
    options?: {
      createIntent?: ContainerCreateIntentInput;
    },
  ) => Promise<void>;
  markCreateIntentSynced: (
    execSql: ExecSql,
    input: {
      containerId: string;
      remoteContainerId: string;
      remoteMetadataAccessStateHash: string;
      remoteMetadataDocumentId: string;
    },
  ) => Promise<void>;
}

function getContainerMetadataScope(containerId: string) {
  return {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
  };
}

function parseCreateIntentSyncStatus(
  value: unknown,
): ContainerCreateIntentSyncStatus {
  return value === "synced" ? "synced" : "pending";
}

function parseContainerCreateIntentRecord(
  row: SqlRow,
): ContainerCreateIntentRecord {
  const id = readSqlRowValue(row, "id");
  const containerId = readSqlRowValue(row, "container_id");
  const parentContainerId = readSqlRowValue(row, "parent_container_id");
  const syncStatus = readSqlRowValue(row, "sync_status");
  const remoteContainerId = readSqlRowValue(row, "remote_container_id");
  const remoteMetadataDocumentId = readSqlRowValue(
    row,
    "remote_metadata_document_id",
  );
  const remoteMetadataAccessStateHash = readSqlRowValue(
    row,
    "remote_metadata_access_state_hash",
  );
  const lastError = readSqlRowValue(row, "last_error");
  const createdAt = readSqlRowValue(row, "created_at");
  const updatedAt = readSqlRowValue(row, "updated_at");

  return {
    id: String(id ?? ""),
    containerId: String(containerId ?? ""),
    parentContainerId: String(parentContainerId ?? ""),
    intentType: CONTAINER_CREATE_INTENT_TYPE,
    syncStatus: parseCreateIntentSyncStatus(syncStatus),
    remoteContainerId:
      remoteContainerId === null || remoteContainerId === undefined
        ? null
        : String(remoteContainerId),
    remoteMetadataDocumentId:
      remoteMetadataDocumentId === null ||
      remoteMetadataDocumentId === undefined
        ? null
        : String(remoteMetadataDocumentId),
    remoteMetadataAccessStateHash:
      remoteMetadataAccessStateHash === null ||
      remoteMetadataAccessStateHash === undefined
        ? null
        : String(remoteMetadataAccessStateHash),
    lastError:
      lastError === null || lastError === undefined ? null : String(lastError),
    createdAt: String(createdAt ?? ""),
    updatedAt: String(updatedAt ?? ""),
  };
}

async function ensureContainerCreateIntentTable(execSql: ExecSql) {
  await execSql(`
 CREATE TABLE IF NOT EXISTS container_create_intents (
 id TEXT PRIMARY KEY,
 container_id TEXT NOT NULL UNIQUE,
 parent_container_id TEXT NOT NULL,
 intent_type TEXT NOT NULL,
 sync_status TEXT NOT NULL,
 remote_container_id TEXT,
 remote_metadata_document_id TEXT,
 remote_metadata_access_state_hash TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
 )
 `);
  await execSql(`
 CREATE INDEX IF NOT EXISTS container_create_intents_status_created_idx
 ON container_create_intents (sync_status, created_at)
 `);
}

async function saveContainerRows(input: {
  execSql: ExecSql;
  container: ContainerRecord;
  updatedAt: string;
}) {
  const { container, execSql, updatedAt } = input;

  await execSql(
    `
 INSERT INTO containers (
 id,
 organization_id,
 parent_id,
 metadata_document_id,
 updated_at
 )
 VALUES (
 :id,
 :organizationId,
 :parentId,
 :metadataDocumentId,
 :updatedAt
 )
 ON CONFLICT(id) DO UPDATE SET
 organization_id = excluded.organization_id,
 parent_id = excluded.parent_id,
 metadata_document_id = excluded.metadata_document_id,
 updated_at = excluded.updated_at
 `,
    {
      ":id": container.id,
      ":organizationId": container.organizationId,
      ":parentId": container.parentId,
      ":metadataDocumentId": container.metadataDocumentId,
      ":updatedAt": updatedAt,
    },
  );

  await execSql(
    `
 INSERT INTO container_projection (
 container_id,
 display_name,
 icon,
 updated_at
 )
 VALUES (
 :id,
 :name,
 :icon,
 :updatedAt
 )
 ON CONFLICT(container_id) DO UPDATE SET
 display_name = excluded.display_name,
 icon = excluded.icon,
 updated_at = excluded.updated_at
 `,
    {
      ":id": container.id,
      ":name": container.name,
      ":icon": container.icon,
      ":updatedAt": updatedAt,
    },
  );
}

async function saveContainerMetadataRecord(input: {
  execSql: ExecSql;
  containerId: string;
  record: DocumentRecord;
  updatedAt: string;
}) {
  const { containerId, execSql, record, updatedAt } = input;
  await execSql(
    `
 INSERT INTO documents (
 app_kind,
 local_id,
 document_id,
 loro_snapshot,
 access_epoch,
 access_state_hash,
 last_commit_lsn,
 document_manifest_bundle,
 content_key_bundle,
 document_kek_targets,
 updated_at
 )
 VALUES (
 :appKind,
 :localId,
 :documentId,
 :loroSnapshot,
 :accessEpoch,
 :accessStateHash,
 :lastCommitLsn,
 :documentManifestBundle,
 :contentKeyBundle,
 :documentKekTargets,
 :updatedAt
 )
 ON CONFLICT(app_kind, local_id) DO UPDATE SET
 document_id = excluded.document_id,
 loro_snapshot = excluded.loro_snapshot,
 access_epoch = excluded.access_epoch,
 access_state_hash = excluded.access_state_hash,
 last_commit_lsn = excluded.last_commit_lsn,
 document_manifest_bundle =
 excluded.document_manifest_bundle,
 content_key_bundle = excluded.content_key_bundle,
 document_kek_targets = excluded.document_kek_targets,
 updated_at = excluded.updated_at
 `,
    {
      ":accessEpoch": record.accessEpoch,
      ":accessStateHash": record.accessStateHash ?? null,
      ":appKind": CONTAINER_METADATA_APP_KIND,
      ":documentId": record.documentId,
      ":lastCommitLsn": record.lastCommitLsn ?? null,
      ":localId": containerId,
      ":loroSnapshot": record.loroSnapshot,
      ":contentKeyBundle": record.contentKeyBundle ?? null,
      ":documentKekTargets": record.documentKekTargets ?? null,
      ":documentManifestBundle": record.documentManifestBundle ?? null,
      ":updatedAt": updatedAt,
    },
  );
}

async function saveContainerCreateIntent(input: {
  execSql: ExecSql;
  containerId: string;
  createIntent: ContainerCreateIntentInput;
  updatedAt: string;
}) {
  const { containerId, createIntent, execSql, updatedAt } = input;
  await execSql(
    `
 INSERT INTO container_create_intents (
 id,
 container_id,
 parent_container_id,
 intent_type,
 sync_status,
 remote_container_id,
 remote_metadata_document_id,
 remote_metadata_access_state_hash,
 last_error,
 created_at,
 updated_at
 )
 VALUES (
 :id,
 :containerId,
 :parentContainerId,
 :intentType,
 'pending',
 NULL,
 NULL,
 NULL,
 NULL,
 :updatedAt,
 :updatedAt
 )
 ON CONFLICT(container_id) DO UPDATE SET
 parent_container_id = excluded.parent_container_id,
 intent_type = excluded.intent_type,
 sync_status = 'pending',
 remote_container_id = NULL,
 remote_metadata_document_id = NULL,
 remote_metadata_access_state_hash = NULL,
 last_error = NULL,
 updated_at = excluded.updated_at
 `,
    {
      ":containerId": containerId,
      ":id": createIntent.id ?? crypto.randomUUID(),
      ":intentType": CONTAINER_CREATE_INTENT_TYPE,
      ":parentContainerId": createIntent.parentContainerId,
      ":updatedAt": updatedAt,
    },
  );
}

export const sqlExplorerPersistence: ExplorerPersistence = {
  async deleteContainer(execSql, containerId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
 DELETE FROM container_create_intents
 WHERE container_id = :containerId
 `,
        {
          ":containerId": containerId,
        },
      );
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
  async deletePendingUpdates(execSql, containerId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getContainerMetadataScope(containerId),
      );
    });
  },
  async ensureSchema(execSql) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureContainerTables(lockedExecSql);
      await ensureDocumentTables(lockedExecSql);
      await ensureContainerCreateIntentTable(lockedExecSql);
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
  async listPendingCreateIntents(execSql) {
    const rows = await execSql(`
 SELECT
 id,
 container_id,
 parent_container_id,
 intent_type,
 sync_status,
 remote_container_id,
 remote_metadata_document_id,
 remote_metadata_access_state_hash,
 last_error,
 created_at,
 updated_at
 FROM container_create_intents
 WHERE sync_status = 'pending'
 AND intent_type = 'container.create'
 ORDER BY created_at ASC
 `);

    return rows.map((row) => parseContainerCreateIntentRecord(row));
  },
  async recordCreateIntentError(execSql, containerId, message) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
 UPDATE container_create_intents
 SET
 last_error = :lastError,
 updated_at = :updatedAt
 WHERE container_id = :containerId
 AND sync_status = 'pending'
 AND intent_type = 'container.create'
 `,
        {
          ":containerId": containerId,
          ":lastError": message,
          ":updatedAt": new Date().toISOString(),
        },
      );
    });
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
  async saveContainer(execSql, container, record, options) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = new Date().toISOString();
      await runSqlTransaction(lockedExecSql, async () => {
        await saveContainerRows({
          container,
          execSql: lockedExecSql,
          updatedAt,
        });

        if (record) {
          await saveContainerMetadataRecord({
            containerId: container.id,
            execSql: lockedExecSql,
            record: {
              ...record,
              id: container.id,
            },
            updatedAt,
          });
        }

        if (options?.createIntent) {
          await saveContainerCreateIntent({
            containerId: container.id,
            createIntent: options.createIntent,
            execSql: lockedExecSql,
            updatedAt,
          });
        }
      });
    });
  },
  async markCreateIntentSynced(execSql, input) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
 UPDATE container_create_intents
 SET
 sync_status = 'synced',
 remote_container_id = :remoteContainerId,
 remote_metadata_document_id = :remoteMetadataDocumentId,
 remote_metadata_access_state_hash = :remoteMetadataAccessStateHash,
 last_error = NULL,
 updated_at = :updatedAt
 WHERE container_id = :containerId
 AND intent_type = 'container.create'
 `,
        {
          ":containerId": input.containerId,
          ":remoteContainerId": input.remoteContainerId,
          ":remoteMetadataAccessStateHash": input.remoteMetadataAccessStateHash,
          ":remoteMetadataDocumentId": input.remoteMetadataDocumentId,
          ":updatedAt": new Date().toISOString(),
        },
      );
    });
  },
};
