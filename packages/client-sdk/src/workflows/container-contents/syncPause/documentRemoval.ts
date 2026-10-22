import {
  listDetachedOrganizationDocumentLocalIds,
  listDocumentLocalIdsPlacedOnlyIn,
} from "../../../data/persistence/container-contents/exclusiveDocumentPlacements";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "../../documents";
import { listPendingWrites } from "../pendingWrites";
import type { ContainerContentsWorkflowRuntimeInfra } from "../runtime";

export interface OrganizationContentRemoval {
  /** Every targeted container and document is gone. */
  readonly complete: boolean;
  readonly deletedContainerIds: readonly string[];
  readonly deletedLocalIds: readonly string[];
}

interface ContainerRemoval {
  readonly containerId: string;
  readonly reason: "access_revoked";
  readonly updatedAt: string;
}

/**
 * Removes a paused organization's containers and the documents placed only in
 * them, unless a persisted pending write (a queued update, a deferred tail, an
 * intent, or an attachment upload) touches the organization, those
 * containers, or those documents. The scan and every deletion hold one SQLite
 * mutation lock, so no persisted write can land between them.
 *
 * The containers go first, under `stillCurrent`; documents are deleted only
 * after every container was. A document an open store holds this session may
 * carry edits that have not reached SQLite, so it is never deleted: it stays,
 * detached but still attributed to the organization, and a later pass removes
 * it once no store holds it. Returns null when the removal refused.
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
}): Promise<OrganizationContentRemoval | null> {
  return runSerializedSqlMutation(input.execSql, async (lockedExecSql) => {
    const containerIds = new Set(input.containerIds);
    const localIds = [
      ...new Set([
        ...(await listDocumentLocalIdsPlacedOnlyIn(
          lockedExecSql,
          input.containerIds,
        )),
        ...(await listDetachedOrganizationDocumentLocalIds(
          lockedExecSql,
          input.organizationId,
        )),
      ]),
    ];
    if (containerIds.size === 0 && localIds.length === 0) {
      return { complete: true, deletedContainerIds: [], deletedLocalIds: [] };
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
      return null;
    }

    const removedAt = new Date().toISOString();
    const deletedContainerIds =
      containerIds.size === 0
        ? []
        : await input.deleteContainers(
            lockedExecSql,
            input.containerIds.map((containerId) => ({
              containerId,
              reason: "access_revoked",
              updatedAt: removedAt,
            })),
          );
    const deletedLocalIds: string[] = [];
    if (deletedContainerIds.length !== containerIds.size) {
      return { complete: false, deletedContainerIds, deletedLocalIds };
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
      complete: deletedLocalIds.length === localIds.length,
      deletedContainerIds,
      deletedLocalIds,
    };
  });
}
