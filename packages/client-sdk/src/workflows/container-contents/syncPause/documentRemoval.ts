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
 * them, unless pending work touches the organization, those containers, or
 * those documents: a persisted pending write (a queued update, a deferred
 * tail, an intent, or an attachment upload) or an edit still queued in an open
 * document store. The scan and every deletion hold one SQLite mutation lock,
 * so no write can persist between them.
 *
 * The containers go first, under `stillCurrent`; documents are deleted only
 * after every container was, and each only while no in-memory edit is queued
 * for it. A document that gained an edit stays to upload it, detached but
 * still attributed to the organization, and a later pass removes it. Returns
 * null when the removal refused.
 */
export async function removeOrganizationContentUnlessPending(input: {
  readonly containerIds: readonly string[];
  readonly deleteContainers: (
    lockedExecSql: ExecSql,
    removals: readonly ContainerRemoval[],
  ) => Promise<readonly string[]>;
  readonly documentProjectors: ContainerContentsWorkflowRuntimeInfra["documentProjectors"];
  readonly execSql: ExecSql;
  readonly hasPendingLocalWrites: (localId: string) => boolean;
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

    if (localIds.some(input.hasPendingLocalWrites)) return null;

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
      if (input.hasPendingLocalWrites(localId)) continue;
      if (
        await deletePersistedDocument({
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
