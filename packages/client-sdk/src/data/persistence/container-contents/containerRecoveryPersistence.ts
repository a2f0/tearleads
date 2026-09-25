import { toFingerprint } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  containerCreateIntents,
  containerMoveIntents,
  documentMoveIntentTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";
import { recordContainerHydrationTombstones } from "./containerHydrationPersistence";
import { repairDocumentsForRemovedContainersInTransaction } from "./containerStructuralRepair";
import { discardLinkIntentsForRemovedContainers } from "./documentLinkRemovalRepair";
import { deleteContainerMetadataDocumentRowsInTransaction } from "./dormantContainerMetadata";

// The token covers all local work the user is agreeing to discard, including
// shared link intents. A second pane's edit invalidates the confirmation.
async function recoverySnapshot(
  execSql: ExecSql,
  containerId: string,
  organizationId: string,
) {
  const [dormant] = await execSql(
    `SELECT container_id, organization_id FROM dormant_container_metadata
    WHERE container_id = ? AND organization_id = ?
    AND NOT EXISTS (SELECT 1 FROM containers WHERE id = ?)`,
    [containerId, organizationId, containerId],
  );
  if (!dormant) return null;
  const metadata = [];
  for (const [table, columns] of [
    [
      "documents",
      "document_id, recovery_document_id, recovery_generation, snapshot_end_version, pending_base_version",
    ],
    ["document_history_checkpoints", "snapshot, end_version_vector"],
    ["document_history_updates", "id, update_data, origin"],
    [
      "document_pending_updates",
      "id, update_data, partial_start_version_vector, partial_end_version_vector, source_version_vector",
    ],
  ]) {
    metadata.push(
      await execSql(
        `SELECT ${columns} FROM ${table} WHERE app_kind = 'container-metadata' AND local_id = ? ORDER BY rowid`,
        [containerId],
      ),
    );
  }
  const creates = await execSql(
    "SELECT id, container_id, parent_container_id, intent_type, remote_container_id, remote_metadata_document_id, remote_metadata_access_state_hash FROM container_create_intents WHERE container_id = ? AND sync_status = 'pending' ORDER BY id",
    [containerId],
  );
  const moves = await execSql(
    "SELECT id, container_id, parent_container_id, previous_parent_container_id, intent_type FROM container_move_intents WHERE container_id = ? ORDER BY id",
    [containerId],
  );
  const links = await execSql(
    `SELECT id, local_id, document_id, target_container_id, source_container_id, replace_linked_containers, intent_type FROM document_move_intents WHERE target_container_id = ? OR id IN
    (SELECT intent_id FROM document_intent_link_targets WHERE container_id = ?) ORDER BY id`,
    [containerId, containerId],
  );
  const targets = await execSql(
    `SELECT intent_id, operation, container_id FROM document_intent_link_targets WHERE intent_id IN
    (SELECT id FROM document_move_intents WHERE target_container_id = ? OR id IN
      (SELECT intent_id FROM document_intent_link_targets WHERE container_id = ?)) ORDER BY intent_id, container_id, operation`,
    [containerId, containerId],
  );
  const revision = await toFingerprint(
    new TextEncoder().encode(
      JSON.stringify([dormant, metadata, creates, moves, links, targets]),
    ),
  );
  return {
    revision,
    pendingUpdateCount: metadata[3]?.length ?? 0,
    hasStructuralIntent: creates.length + moves.length + links.length > 0,
  };
}

export async function listRetainedContainerMetadata(
  execSql: ExecSql,
  organizationId: string | null,
) {
  if (!organizationId) return [];
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  await ensureSqlTables(execSql, documentMoveIntentTables);
  return runSerializedSqlMutation(execSql, async (locked) =>
    getClientSQLitePersistenceRuntime(locked).transaction(async () => {
      const rows = await locked(
        `SELECT container_id FROM dormant_container_metadata
      WHERE organization_id = ? ORDER BY container_id`,
        [organizationId],
      );
      const result = [];
      for (const row of rows) {
        const containerId = String(Reflect.get(row, "container_id"));
        const snapshot = await recoverySnapshot(
          locked,
          containerId,
          organizationId,
        );
        if (!snapshot) continue;
        const record =
          await sqlContainerContentsPersistence.loadContainerMetadataRecord(
            locked,
            containerId,
          );
        result.push({
          containerId,
          organizationId,
          ...snapshot,
          metadataUpdates: record?.metadataUpdates ?? "",
        });
      }
      return result;
    }),
  );
}

/** Explicit local discard, never called by remote discovery. */
export async function discardRetainedContainerMetadata(
  execSql: ExecSql,
  input: {
    containerId: string;
    organizationId: string;
    revision: string;
  },
): Promise<boolean> {
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  await ensureSqlTables(execSql, documentMoveIntentTables);
  return runSerializedSqlMutation(execSql, async (locked) =>
    getClientSQLitePersistenceRuntime(locked).transaction(
      async (tx) => {
        const current = await recoverySnapshot(
          locked,
          input.containerId,
          input.organizationId,
        );
        if (!current || current.revision !== input.revision) return false;
        await recordContainerHydrationTombstones({
          tx,
          removals: [
            {
              containerId: input.containerId,
              reason: "deleted",
              updatedAt: new Date().toISOString(),
            },
          ],
        });
        await repairDocumentsForRemovedContainersInTransaction({
          tx,
          removals: [
            {
              containerId: input.containerId,
              reason: "deleted",
              updatedAt: new Date().toISOString(),
            },
          ],
        });
        await discardLinkIntentsForRemovedContainers({
          tx,
          containerIds: [input.containerId],
        });
        await tx
          .delete(containerCreateIntents)
          .where(eq(containerCreateIntents.containerId, input.containerId))
          .run();
        await tx
          .delete(containerMoveIntents)
          .where(eq(containerMoveIntents.containerId, input.containerId))
          .run();
        await deleteContainerMetadataDocumentRowsInTransaction(tx, [
          input.containerId,
        ]);
        return true;
      },
      { behavior: "immediate" },
    ),
  );
}

export async function hasRetainedContainerMetadata(
  execSql: ExecSql,
  organizationId: string | null,
): Promise<boolean> {
  if (!organizationId) return false;
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  const rows = await execSql(
    `SELECT 1 FROM dormant_container_metadata d
    WHERE d.organization_id = ? AND NOT EXISTS (SELECT 1 FROM containers c WHERE c.id = d.container_id) LIMIT 1`,
    [organizationId],
  );
  return rows.length > 0;
}

/** Existing local folders whose queued move points at an unavailable parent. */
export async function listRecoveryFolderMoveIds(
  execSql: ExecSql,
  organizationId: string | null,
): Promise<string[]> {
  if (!organizationId) return [];
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  const rows = await execSql(
    `SELECT c.id FROM containers c JOIN container_move_intents i
    ON i.container_id = c.id AND i.parent_container_id = c.parent_id
    WHERE c.organization_id = ? AND i.sync_status IN ('pending', 'blocked')
    AND NOT EXISTS (SELECT 1 FROM containers p WHERE p.id = c.parent_id)
    ORDER BY c.id`,
    [organizationId],
  );
  return rows.map((row) => String(Reflect.get(row, "id")));
}
