import { listDocumentLocalIdsPlacedOnlyIn } from "../../../data/persistence/container-contents/exclusiveDocumentPlacements";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import { registerClientSQLiteCommitGuard } from "../../../data/sqlite/sqliteCommitGuards";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "../../documents";
import { listPendingWrites } from "../pendingWrites";
import type { ContainerContentsWorkflowRuntimeInfra } from "../runtime";

export interface OrganizationContentRemoval {
  /**
   * `removed` when every targeted container and document is gone.
   * `pending-writes` and `queued-edits` refused before deleting anything.
   * `interrupted` stopped part way: the removal stopped being current, or a
   * document was edited while it ran and stayed.
   */
  readonly status:
    | "removed"
    | "pending-writes"
    | "queued-edits"
    | "interrupted";
  readonly deletedContainerIds: readonly string[];
  readonly deletedLocalIds: readonly string[];
}

// The deletion cascade binds several values per container across its
// statements (its tombstone row alone binds a value per column), so a large
// organization is removed in batches that stay within SQLite's bind budget.
const CONTAINER_REMOVAL_BATCH_SIZE = 50;

const refused = (
  status: "pending-writes" | "queued-edits",
): OrganizationContentRemoval => ({
  deletedContainerIds: [],
  deletedLocalIds: [],
  status,
});

interface ContainerRemoval {
  readonly containerId: string;
  readonly reason: "access_revoked";
  readonly updatedAt: string;
}

/** Stops at the first batch that is no longer current. */
async function deleteContainersInBatches(
  lockedExecSql: ExecSql,
  containerIds: readonly string[],
  deleteContainers: (
    lockedExecSql: ExecSql,
    removals: readonly ContainerRemoval[],
  ) => Promise<readonly string[]>,
): Promise<string[]> {
  const removedAt = new Date().toISOString();
  const deleted: string[] = [];
  for (
    let index = 0;
    index < containerIds.length;
    index += CONTAINER_REMOVAL_BATCH_SIZE
  ) {
    const batch = containerIds.slice(
      index,
      index + CONTAINER_REMOVAL_BATCH_SIZE,
    );
    const removed = await deleteContainers(
      lockedExecSql,
      batch.map((containerId) => ({
        containerId,
        reason: "access_revoked",
        updatedAt: removedAt,
      })),
    );
    deleted.push(...removed);
    if (removed.length !== batch.length) break;
  }
  return deleted;
}

class DocumentEditedDuringRemoval extends Error {}

/**
 * Deletes one document unless a store queues a write for it before the
 * deletion commits. The check runs as a commit guard, in the same synchronous
 * slice as the COMMIT, so an edit queued while the rows were being deleted
 * rolls the deletion back instead of persisting into a missing row.
 */
async function deleteDocumentUnlessEdited(input: {
  readonly documentProjectors: ContainerContentsWorkflowRuntimeInfra["documentProjectors"];
  readonly execSql: ExecSql;
  readonly hasQueuedWrites: (localId: string) => boolean;
  readonly localId: string;
}): Promise<boolean> {
  const expectedRecord = await defaultDocumentsPersistence.loadDocument(
    input.execSql,
    input.localId,
  );
  if (!expectedRecord) return false;
  try {
    return await deletePersistedDocument({
      beforeDeleteInTransaction: async (transactionExecSql) => {
        registerClientSQLiteCommitGuard(transactionExecSql, () => {
          if (input.hasQueuedWrites(input.localId)) {
            throw new DocumentEditedDuringRemoval();
          }
        });
      },
      documentProjectors: input.documentProjectors,
      execSql: input.execSql,
      expectedRecord,
      localId: input.localId,
      persistence: defaultDocumentsPersistence,
    });
  } catch (error) {
    if (error instanceof DocumentEditedDuringRemoval) return false;
    throw error;
  }
}

/**
 * Removes a paused organization's containers and the documents placed only in
 * them, unless a persisted pending write (a queued update, a deferred tail, an
 * intent, or an attachment upload) touches the organization, those
 * containers, or those documents. The scan and every deletion hold one SQLite
 * mutation lock, so no persisted write can land between them.
 *
 * An open store may also hold edits that have not reached SQLite yet, so
 * the removal refuses while any targeted document has queued writes; they
 * persist as pending writes and upload, and a later pass removes the rest.
 * The containers go first, under `stillCurrent`; documents are deleted only
 * after every container was, each under a commit guard against an edit
 * queued meanwhile. A document edited mid-removal stays as a detached local
 * copy, like any document whose container this device lost. Documents that
 * were already detached are never touched: they may be the only copy of work
 * a recovery still needs.
 */
export async function removeOrganizationContentUnlessPending(input: {
  readonly containerIds: readonly string[];
  readonly deleteContainers: (
    lockedExecSql: ExecSql,
    removals: readonly ContainerRemoval[],
  ) => Promise<readonly string[]>;
  readonly documentProjectors: ContainerContentsWorkflowRuntimeInfra["documentProjectors"];
  readonly execSql: ExecSql;
  /** Whether an open store holds writes for the document not yet in SQLite. */
  readonly hasQueuedWrites: (localId: string) => boolean;
  readonly organizationId: string;
}): Promise<OrganizationContentRemoval> {
  return runSerializedSqlMutation(input.execSql, async (lockedExecSql) => {
    const containerIds = new Set(input.containerIds);
    const localIds = await listDocumentLocalIdsPlacedOnlyIn(
      lockedExecSql,
      input.containerIds,
    );
    if (containerIds.size === 0 && localIds.length === 0) {
      return {
        deletedContainerIds: [],
        deletedLocalIds: [],
        status: "removed",
      };
    }
    const documentIds = new Set(localIds);
    const pending = await listPendingWrites(lockedExecSql);
    if (
      pending.some(
        (item) =>
          item.organizationId === input.organizationId ||
          (item.containerId !== null && containerIds.has(item.containerId)) ||
          documentIds.has(item.localId),
      )
    ) {
      return refused("pending-writes");
    }
    if (localIds.some(input.hasQueuedWrites)) return refused("queued-edits");

    const deletedContainerIds = await deleteContainersInBatches(
      lockedExecSql,
      [...containerIds],
      input.deleteContainers,
    );
    const deletedLocalIds: string[] = [];
    if (deletedContainerIds.length !== containerIds.size) {
      return { deletedContainerIds, deletedLocalIds, status: "interrupted" };
    }
    for (const localId of localIds) {
      if (
        await deleteDocumentUnlessEdited({
          documentProjectors: input.documentProjectors,
          execSql: lockedExecSql,
          hasQueuedWrites: input.hasQueuedWrites,
          localId,
        })
      ) {
        deletedLocalIds.push(localId);
      }
    }
    return {
      deletedContainerIds,
      deletedLocalIds,
      status:
        deletedLocalIds.length === localIds.length ? "removed" : "interrupted",
    };
  });
}
