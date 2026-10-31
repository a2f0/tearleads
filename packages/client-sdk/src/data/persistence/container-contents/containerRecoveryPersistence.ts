import { toFingerprint } from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import {
  documentPlacementIntentTables,
  inContainerIntentLanes,
  LOCAL_INTENT_LANES,
  localIntents,
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

const RECOVERY_METADATA_TABLES = [
  [
    "documents",
    "document_id, recovery_document_id, recovery_generation, snapshot_end_version, pending_base_version",
  ],
  ["document_history_checkpoints", "snapshot, end_version_vector"],
  [
    "document_history_updates",
    "id, update_data, origin, update_id, partial_start_version_vector, partial_end_version_vector, source_version_vector",
  ],
] as const;
const CREATE_COLUMNS =
  "id, subject_id, target_container_id, intent_type, remote_container_id, remote_metadata_document_id, remote_metadata_access_state_hash";
const MOVE_COLUMNS =
  "id, subject_id, target_container_id, source_container_id, intent_type";
const LINK_COLUMNS =
  "id, local_id, subject_id, target_container_id, source_container_id, replace_linked_containers, intent_type";
const TARGET_COLUMNS = "intent_id, operation, container_id";

type RecoveryRows = Awaited<ReturnType<ExecSql>>;

// The token covers all local work the user is agreeing to discard, including
// shared link intents. A second pane's edit invalidates the confirmation.
async function summarizeRecoverySnapshot(input: {
  creates: RecoveryRows;
  dormant: RecoveryRows[number];
  links: RecoveryRows;
  metadata: RecoveryRows[];
  moves: RecoveryRows;
  targets: RecoveryRows;
}) {
  const { creates, dormant, links, metadata, moves, targets } = input;
  const revision = await toFingerprint(
    new TextEncoder().encode(
      JSON.stringify([dormant, metadata, creates, moves, links, targets]),
    ),
  );
  return {
    revision,
    pendingUpdateCount: (metadata[2] ?? []).filter(
      (row) => Reflect.get(row, "update_id") !== null,
    ).length,
    hasStructuralIntent: creates.length + moves.length + links.length > 0,
  };
}

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
  for (const [table, columns] of RECOVERY_METADATA_TABLES) {
    metadata.push(
      await execSql(
        `SELECT ${columns} FROM ${table} WHERE app_kind = 'container-metadata' AND local_id = ? ORDER BY rowid`,
        [containerId],
      ),
    );
  }
  const creates = await execSql(
    `SELECT ${CREATE_COLUMNS} FROM local_intents WHERE lane = ? AND subject_id = ? AND sync_status = 'pending' ORDER BY id`,
    [LOCAL_INTENT_LANES.containerCreate, containerId],
  );
  const moves = await execSql(
    `SELECT ${MOVE_COLUMNS} FROM local_intents WHERE lane = ? AND subject_id = ? ORDER BY id`,
    [LOCAL_INTENT_LANES.containerMove, containerId],
  );
  const placementWhere = `lane = ? AND (target_container_id = ? OR id IN
    (SELECT intent_id FROM document_intent_link_targets WHERE container_id = ?))`;
  const placementBind = [
    LOCAL_INTENT_LANES.documentPlacement,
    containerId,
    containerId,
  ];
  const links = await execSql(
    `SELECT ${LINK_COLUMNS} FROM local_intents WHERE ${placementWhere} ORDER BY id`,
    placementBind,
  );
  const targets = await execSql(
    `SELECT ${TARGET_COLUMNS} FROM document_intent_link_targets WHERE intent_id IN
    (SELECT id FROM local_intents WHERE ${placementWhere}) ORDER BY intent_id, container_id, operation`,
    placementBind,
  );
  return summarizeRecoverySnapshot({
    creates,
    dormant,
    links,
    metadata,
    moves,
    targets,
  });
}

/** Rows grouped by one column's value, dropping that column when asked. */
function groupRows(
  rows: RecoveryRows,
  column: string,
  drop: boolean,
): Map<string, RecoveryRows> {
  const groups = new Map<string, RecoveryRows>();
  for (const row of rows) {
    const key = String(Reflect.get(row, column));
    const kept = drop
      ? Object.fromEntries(
          Object.entries(row).filter(([name]) => name !== column),
        )
      : row;
    const group = groups.get(key);
    if (group) group.push(kept);
    else groups.set(key, [kept]);
  }
  return groups;
}

/** Keeps SQL `IN` lists, bound twice by the placement reads, under the budget. */
const RECOVERY_CONTAINER_BATCH_SIZE = 400;

/** Every row the recovery snapshots of a batch of folders read. */
async function readRecoveryBatchRows(execSql: ExecSql, ids: string[]) {
  const list = ids.map(() => "?").join(", ");
  const metadata = [];
  for (const [table, columns] of RECOVERY_METADATA_TABLES) {
    metadata.push(
      groupRows(
        await execSql(
          `SELECT local_id, ${columns} FROM ${table} WHERE app_kind = 'container-metadata' AND local_id IN (${list}) ORDER BY local_id, rowid`,
          ids,
        ),
        "local_id",
        true,
      ),
    );
  }
  const creates = groupRows(
    await execSql(
      `SELECT ${CREATE_COLUMNS} FROM local_intents WHERE lane = ? AND subject_id IN (${list}) AND sync_status = 'pending' ORDER BY subject_id, id`,
      [LOCAL_INTENT_LANES.containerCreate, ...ids],
    ),
    "subject_id",
    false,
  );
  const moves = groupRows(
    await execSql(
      `SELECT ${MOVE_COLUMNS} FROM local_intents WHERE lane = ? AND subject_id IN (${list}) ORDER BY subject_id, id`,
      [LOCAL_INTENT_LANES.containerMove, ...ids],
    ),
    "subject_id",
    false,
  );
  const placementWhere = `lane = ? AND (target_container_id IN (${list}) OR id IN
    (SELECT intent_id FROM document_intent_link_targets WHERE container_id IN (${list})))`;
  const placementBind = [LOCAL_INTENT_LANES.documentPlacement, ...ids, ...ids];
  // Every placement intent any folder in the batch reaches, and ALL link
  // targets of those intents: a folder's share is then the intents that
  // target it or carry a link target in it, as the per-folder read selects.
  const links = await execSql(
    `SELECT ${LINK_COLUMNS} FROM local_intents WHERE ${placementWhere} ORDER BY id`,
    placementBind,
  );
  const targets = await execSql(
    `SELECT ${TARGET_COLUMNS} FROM document_intent_link_targets WHERE intent_id IN
    (SELECT id FROM local_intents WHERE ${placementWhere}) ORDER BY intent_id, container_id, operation`,
    placementBind,
  );
  return { creates, links, metadata, moves, targets };
}

/**
 * Each folder's share of a batch's placement rows, indexed in one pass: the
 * intents that target the folder or carry a link target in it (in intent id
 * order), and all link targets of those intents (in the per-folder order).
 */
function indexPlacementRows(
  rows: Awaited<ReturnType<typeof readRecoveryBatchRows>>,
) {
  const targetsByIntent = groupRows(rows.targets, "intent_id", false);
  const linksByFolder = new Map<string, RecoveryRows>();
  for (const link of rows.links) {
    const intentId = String(Reflect.get(link, "id"));
    const folders = new Set([
      String(Reflect.get(link, "target_container_id")),
      ...(targetsByIntent.get(intentId) ?? []).map((target) =>
        String(Reflect.get(target, "container_id")),
      ),
    ]);
    for (const folder of folders) {
      const folderLinks = linksByFolder.get(folder);
      if (folderLinks) folderLinks.push(link);
      else linksByFolder.set(folder, [link]);
    }
  }
  return { linksByFolder, targetsByIntent };
}

/** One folder's snapshot from its batch's rows, in the per-folder shape. */
async function folderRecoverySnapshot(
  rows: Awaited<ReturnType<typeof readRecoveryBatchRows>>,
  placements: ReturnType<typeof indexPlacementRows>,
  containerId: string,
  dormant: RecoveryRows[number],
) {
  const links = placements.linksByFolder.get(containerId) ?? [];
  // Links are in intent id order and targets in (intent id, container,
  // operation) order, so concatenating per link keeps the per-folder order.
  const targets = links.flatMap(
    (link) =>
      placements.targetsByIntent.get(String(Reflect.get(link, "id"))) ?? [],
  );
  const metadata = rows.metadata.map(
    (byFolder) => byFolder.get(containerId) ?? [],
  );
  // The metadata record's updates are its checkpoint snapshot, read above; a
  // folder with no record has none.
  const snapshotRow = (metadata[1] ?? [])[0];
  return {
    containerId,
    metadataUpdates:
      (metadata[0] ?? []).length > 0 && snapshotRow
        ? String(Reflect.get(snapshotRow, "snapshot") ?? "")
        : "",
    snapshot: await summarizeRecoverySnapshot({
      creates: rows.creates.get(containerId) ?? [],
      dormant,
      links,
      metadata,
      moves: rows.moves.get(containerId) ?? [],
      targets,
    }),
  };
}

/**
 * `recoverySnapshot` for every retained folder of an organization, one read
 * per table for each batch of folders. Each folder's rows are grouped in the
 * per-folder order (`local_id, rowid` for metadata; `subject_id, id` for
 * folder intents), so its revision is byte-identical to `recoverySnapshot`'s,
 * which a later discard compares.
 */
async function recoverySnapshots(execSql: ExecSql, organizationId: string) {
  const dormantRows = await execSql(
    `SELECT container_id, organization_id FROM dormant_container_metadata d
    WHERE organization_id = ?
    AND NOT EXISTS (SELECT 1 FROM containers WHERE id = d.container_id)
    ORDER BY container_id`,
    [organizationId],
  );
  const result = [];
  for (
    let offset = 0;
    offset < dormantRows.length;
    offset += RECOVERY_CONTAINER_BATCH_SIZE
  ) {
    const batch = dormantRows.slice(
      offset,
      offset + RECOVERY_CONTAINER_BATCH_SIZE,
    );
    const ids = batch.map((row) => String(Reflect.get(row, "container_id")));
    const rows = await readRecoveryBatchRows(execSql, ids);
    const placements = indexPlacementRows(rows);
    for (const [index, dormant] of batch.entries()) {
      result.push(
        await folderRecoverySnapshot(
          rows,
          placements,
          ids[index] ?? "",
          dormant,
        ),
      );
    }
  }
  return result;
}

export async function listRetainedContainerMetadata(
  execSql: ExecSql,
  organizationId: string | null,
) {
  if (!organizationId) return [];
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  await ensureSqlTables(execSql, documentPlacementIntentTables);
  return runSerializedSqlMutation(execSql, async (locked) =>
    getClientSQLitePersistenceRuntime(locked).transaction(async () =>
      (await recoverySnapshots(locked, organizationId)).map(
        ({ containerId, metadataUpdates, snapshot }) => ({
          containerId,
          organizationId,
          ...snapshot,
          metadataUpdates,
        }),
      ),
    ),
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
  await ensureSqlTables(execSql, documentPlacementIntentTables);
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
          .delete(localIntents)
          .where(
            and(
              inContainerIntentLanes(),
              eq(localIntents.subjectId, input.containerId),
            ),
          )
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

/** Retained metadata of an organization's absent folders; binds the org. */
export const RETAINED_CONTAINER_METADATA_SQL = `SELECT 1 FROM dormant_container_metadata d
    WHERE d.organization_id = ? AND NOT EXISTS (SELECT 1 FROM containers c WHERE c.id = d.container_id)`;

/**
 * An organization's local folders whose queued move points at an unavailable
 * parent; binds the move lane, then the organization.
 */
export const RECOVERY_FOLDER_MOVES_SQL = `SELECT c.id FROM containers c JOIN local_intents i
    ON i.lane = ? AND i.subject_id = c.id AND i.target_container_id = c.parent_id
    WHERE c.organization_id = ? AND i.sync_status IN ('pending', 'blocked')
    AND NOT EXISTS (SELECT 1 FROM containers p WHERE p.id = c.parent_id)`;

/** Existing local folders whose queued move points at an unavailable parent. */
export async function listRecoveryFolderMoveIds(
  execSql: ExecSql,
  organizationId: string | null,
): Promise<string[]> {
  if (!organizationId) return [];
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  const rows = await execSql(`${RECOVERY_FOLDER_MOVES_SQL} ORDER BY c.id`, [
    LOCAL_INTENT_LANES.containerMove,
    organizationId,
  ]);
  return rows.map((row) => String(Reflect.get(row, "id")));
}
