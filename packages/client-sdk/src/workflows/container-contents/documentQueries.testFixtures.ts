import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerDocumentRecord,
  defaultContainerContentsPersistence,
} from "./containerPersistence";
import { listPendingWrites } from "./pendingWrites";

/** Run the pending-write listing once so its tables exist. */
export async function ensurePendingWriteSchema(
  execSql: ExecSql,
): Promise<void> {
  await listPendingWrites(execSql);
}

export async function saveTestContainer(input: {
  execSql: Parameters<
    typeof defaultContainerContentsPersistence.saveContainer
  >[0];
  icon?: string | null;
  id: string;
  name: string;
  organizationId?: string | undefined;
  parentId: string | null;
  systemSlot?: string | null;
  timestamp: string;
}) {
  await defaultContainerContentsPersistence.saveContainer(
    input.execSql,
    {
      icon: input.icon ?? null,
      id: input.id,
      effectiveAccessLevel: "admin",
      metadataDocumentId: null,
      name: input.name,
      organizationId: input.organizationId ?? "org-1",
      parentId: input.parentId,
      systemSlot: input.systemSlot ?? null,
    },
    null,
    { localUpdatedAt: input.timestamp },
  );
}

/**
 * Save a container that already synced: a metadata document record plus server
 * timestamps, with the ids the suites derive from the container id
 * (`metadata-<id>`, `access-<id>`).
 */
export async function saveTestSyncedContainer(input: {
  accessLevel?: "admin" | "write";
  execSql: Parameters<
    typeof defaultContainerContentsPersistence.saveContainer
  >[0];
  id: string;
  metadataUpdates?: string;
  name: string;
  organizationId: string;
  parentId?: string | null | undefined;
  pullContinuation?: ContainerDocumentRecord["pullContinuation"];
  snapshotEndVersion?: string;
  timestamp: string;
}) {
  const metadataDocumentId = `metadata-${input.id}`;
  await defaultContainerContentsPersistence.saveContainer(
    input.execSql,
    {
      effectiveAccessLevel: input.accessLevel ?? "admin",
      icon: null,
      id: input.id,
      metadataDocumentId,
      name: input.name,
      organizationId: input.organizationId,
      parentId: input.parentId ?? null,
    },
    {
      accessEpoch: 1,
      accessStateHash: `access-${input.id}`,
      documentId: metadataDocumentId,
      id: input.id,
      metadataUpdates: input.metadataUpdates ?? "",
      ...(input.pullContinuation === undefined
        ? {}
        : { pullContinuation: input.pullContinuation }),
      snapshotEndVersion: input.snapshotEndVersion ?? "",
    },
    {
      localUpdatedAt: input.timestamp,
      serverTimestamps: {
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      },
    },
  );
}

/** Insert one raw pending-update row (`source_version_vector` stays NULL). */
export async function insertTestPendingUpdate(input: {
  appKind: string;
  createdAt: string;
  execSql: ExecSql;
  id: string;
  localId: string;
  partialEndVersionVector?: string | undefined;
  partialStartVersionVector?: string | undefined;
  updateData?: string | undefined;
}): Promise<void> {
  await input.execSql(
    `INSERT INTO document_pending_updates (
      id, app_kind, local_id, update_data,
      partial_start_version_vector, partial_end_version_vector,
      source_version_vector, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      input.id,
      input.appKind,
      input.localId,
      input.updateData ?? "payload",
      input.partialStartVersionVector ?? "{}",
      input.partialEndVersionVector ?? "{}",
      input.createdAt,
    ],
  );
}

export async function saveTestDocument(input: {
  containerId: string;
  documentId: string | null;
  execSql: Parameters<typeof sqlDocumentsPersistence.saveDocument>[0];
  id: string;
  kind?: "note" | "drivers_license" | "credit_card";
  title: string;
  updatedAt: string;
}) {
  await sqlDocumentsPersistence.saveDocument(
    input.execSql,
    {
      accessEpoch: 1,
      containerId: input.containerId,
      documentId: input.documentId,
      documentKind: input.kind ?? "note",
      id: input.id,
      snapshotEndVersion: "",
      text: input.title,
      title: input.title,
    },
    { updatedAt: input.updatedAt },
  );
}
