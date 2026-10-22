import { listDocumentLocalIdsPlacedOnlyIn } from "../../../data/persistence/container-contents/exclusiveDocumentPlacements";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
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
   * `pending-writes` and `open-documents` refused before deleting anything.
   * `interrupted` stopped part way: the removal stopped being current, or a
   * store opened on a document while it ran and that document stayed.
   */
  readonly status:
    | "removed"
    | "pending-writes"
    | "open-documents"
    | "interrupted";
  readonly deletedContainerIds: readonly string[];
  readonly deletedLocalIds: readonly string[];
}

// The deletion cascade binds several values per container across its
// statements (its tombstone row alone binds a value per column), so a large
// organization is removed in batches that stay within SQLite's bind budget.
const CONTAINER_REMOVAL_BATCH_SIZE = 50;

const refused = (
  status: "pending-writes" | "open-documents",
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

/**
 * Removes a paused organization's containers and the documents placed only in
 * them, unless a persisted pending write (a queued update, a deferred tail, an
 * intent, or an attachment upload) touches the organization, those
 * containers, or those documents. The scan and every deletion hold one SQLite
 * mutation lock, so no persisted write can land between them.
 *
 * A document an open store holds this session may carry edits that have not
 * reached SQLite, so the removal also refuses while any targeted document is
 * open, leaving the organization's content whole and syncing. The containers
 * go first, under `stillCurrent`; documents are deleted only after every
 * container was, each re-checked right before its rows go. A document whose
 * store opened mid-removal stays as a detached local copy, like any document
 * whose container this device lost. Documents that were already detached are
 * never touched: they may be the only copy of work a recovery still needs.
 */
export async function removeOrganizationContentUnlessPending(input: {
  readonly containerIds: readonly string[];
  readonly deleteContainers: (
    lockedExecSql: ExecSql,
    removals: readonly ContainerRemoval[],
  ) => Promise<readonly string[]>;
  readonly documentProjectors: ContainerContentsWorkflowRuntimeInfra["documentProjectors"];
  readonly execSql: ExecSql;
  /** Whether an open document store holds the document this session. */
  readonly isDocumentOpen: (localId: string) => boolean;
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
    if (localIds.some(input.isDocumentOpen)) return refused("open-documents");

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
        await deletePersistedDocument({
          // Checked inside the claimed mutation, right before the rows go.
          canStartDurableMutation: () => !input.isDocumentOpen(localId),
          documentProjectors: input.documentProjectors,
          execSql: lockedExecSql,
          localId,
          persistence: defaultDocumentsPersistence,
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
