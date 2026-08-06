import { base64ToBytes } from "@tearleads/encoding";
import { getImportBlobMetadata } from "@tearleads/loro";
import { and, eq } from "drizzle-orm";
import { mapSelectedDocumentRecord } from "../../sqlite/documentPersistence";
import { documentHistoryCheckpoints, documents } from "../../sqlite/schema";
import {
  type ClientSQLiteTransaction,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  type ContainerRecord,
  saveContainerRows,
} from "../containers/containerPersistence";
import type {
  ContainerCreateIntentInput,
  ContainerMetadataRecord,
  ContainerMoveIntentInput,
} from "./containerContentsPersistenceTypes";
import {
  saveContainerCreateIntent,
  saveContainerMoveIntent,
} from "./containerIntentPersistence";
import {
  CONTAINER_METADATA_APP_KIND,
  clearDormantContainerMetadataInTransaction,
} from "./dormantContainerMetadata";

export function getContainerMetadataScope(containerId: string) {
  return {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
  };
}

// The metadata document's content frontier, derived from its full updates
// export. Empty or undecodable blobs read as "never hydrated".
function deriveMetadataEndVersion(metadataUpdates: string): string {
  if (metadataUpdates.length === 0) {
    return "";
  }

  try {
    return getImportBlobMetadata(base64ToBytes(metadataUpdates))
      .partialEndVersionVector;
  } catch {
    return "";
  }
}

async function saveContainerMetadataRecord(input: {
  containerId: string;
  record: ContainerMetadataRecord;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}) {
  const { containerId, record, tx, updatedAt } = input;
  const snapshotEndVersion = deriveMetadataEndVersion(record.metadataUpdates);
  const nextRow = {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
    documentId: record.documentId,
    snapshotEndVersion,
    accessEpoch: record.accessEpoch,
    accessStateHash: record.accessStateHash ?? null,
    lastCommitLsn: record.lastCommitLsn ?? null,
    documentManifestBundle: record.documentManifestBundle ?? null,
    contentKeyBundle: record.contentKeyBundle ?? null,
    documentKekTargets: record.documentKekTargets ?? null,
    updatedAt,
  };

  await tx
    .insert(documents)
    .values(nextRow)
    .onConflictDoUpdate({
      target: [documents.appKind, documents.localId],
      set: nextRow,
    })
    .run();

  // The metadata document's content lives in the shared history-checkpoint
  // table, like every other document kind. The whole updates export IS the
  // checkpoint: metadata documents are tiny registries, so no tail/compaction
  // machinery is needed, and the row replaces atomically with the record.
  const checkpointRow = {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
    snapshot: record.metadataUpdates,
    endVersionVector: snapshotEndVersion,
    revision: updatedAt,
    updatedAt,
  };
  await tx
    .insert(documentHistoryCheckpoints)
    .values(checkpointRow)
    .onConflictDoUpdate({
      target: [
        documentHistoryCheckpoints.appKind,
        documentHistoryCheckpoints.localId,
      ],
      set: checkpointRow,
    })
    .run();
}

export async function saveContainerContentsContainerRows(input: {
  container: ContainerRecord;
  createIntent?: ContainerCreateIntentInput | undefined;
  moveIntent?: ContainerMoveIntentInput | undefined;
  record: ContainerMetadataRecord | null;
  tx: ClientSQLiteTransaction;
  localUpdatedAt: string;
  serverTimestamps?:
    | {
        createdAt?: string | null;
        updatedAt?: string | null;
      }
    | undefined;
}): Promise<ContainerRecord> {
  const {
    container,
    createIntent,
    moveIntent,
    localUpdatedAt,
    record,
    serverTimestamps,
    tx,
  } = input;
  const nextContainer = {
    ...container,
    ...(serverTimestamps
      ? {
          serverCreatedAt:
            serverTimestamps.createdAt ?? container.serverCreatedAt ?? null,
          serverUpdatedAt:
            serverTimestamps.updatedAt ?? container.serverUpdatedAt ?? null,
        }
      : {}),
  };

  const savedContainer = await saveContainerRows({
    record: nextContainer,
    tx,
    localUpdatedAt,
  });
  await clearDormantContainerMetadataInTransaction(tx, [container.id]);

  if (record) {
    await saveContainerMetadataRecord({
      containerId: container.id,
      record: {
        ...record,
        id: container.id,
      },
      tx,
      updatedAt: localUpdatedAt,
    });
  }

  if (createIntent) {
    await saveContainerCreateIntent({
      containerId: container.id,
      createIntent,
      tx,
      updatedAt: localUpdatedAt,
    });
  }

  if (moveIntent) {
    await saveContainerMoveIntent({
      containerId: container.id,
      moveIntent,
      tx,
      updatedAt: localUpdatedAt,
    });
  }

  return savedContainer;
}

/**
 * ONE joined statement, so the record's key/access fields and the checkpoint
 * content it pairs with come from a single consistent read — two separate
 * queries could interleave with a concurrent metadata save (record +
 * checkpoint written in one transaction) and pair stale keying state with
 * newer content.
 */
export async function selectContainerMetadataRecord(
  execSql: ExecSql,
  containerId: string,
): Promise<ContainerMetadataRecord | null> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      id: documents.localId,
      documentId: documents.documentId,
      snapshotEndVersion: documents.snapshotEndVersion,
      accessEpoch: documents.accessEpoch,
      accessStateHash: documents.accessStateHash,
      effectiveAccessLevel: documents.effectiveAccessLevel,
      lastCommitLsn: documents.lastCommitLsn,
      documentManifestBundle: documents.documentManifestBundle,
      contentKeyBundle: documents.contentKeyBundle,
      documentKekTargets: documents.documentKekTargets,
      pendingBaseVersion: documents.pendingBaseVersion,
      metadataUpdates: documentHistoryCheckpoints.snapshot,
    })
    .from(documents)
    .leftJoin(
      documentHistoryCheckpoints,
      and(
        eq(documentHistoryCheckpoints.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documentHistoryCheckpoints.localId, documents.localId),
      ),
    )
    .where(
      and(
        eq(documents.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documents.localId, containerId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const { metadataUpdates, ...recordRow } = row;
  return {
    ...mapSelectedDocumentRecord(recordRow),
    metadataUpdates: metadataUpdates ?? "",
  };
}
