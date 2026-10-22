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
 * them, unless any pending write (a queued update, a deferred tail, an intent,
 * or an attachment upload) touches the organization, those containers, or
 * those documents. The scan and every deletion hold one SQLite mutation lock,
 * so no write can land between them. Returns null when it refused.
 */
export async function removeOrganizationContentUnlessPending(input: {
  readonly containerIds: readonly string[];
  readonly deleteContainers: (
    lockedExecSql: ExecSql,
    removals: readonly ContainerRemoval[],
  ) => Promise<readonly string[]>;
  readonly documentProjectors: ContainerContentsWorkflowRuntimeInfra["documentProjectors"];
  readonly execSql: ExecSql;
  readonly organizationId: string;
}): Promise<OrganizationContentRemoval | null> {
  return runSerializedSqlMutation(input.execSql, async (lockedExecSql) => {
    const containerIds = new Set(input.containerIds);
    const localIds = await listDocumentLocalIdsPlacedOnlyIn(
      lockedExecSql,
      input.containerIds,
    );
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

    const deletedLocalIds: string[] = [];
    for (const localId of localIds) {
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
    const removedAt = new Date().toISOString();
    const deletedContainerIds = await input.deleteContainers(
      lockedExecSql,
      input.containerIds.map((containerId) => ({
        containerId,
        reason: "access_revoked",
        updatedAt: removedAt,
      })),
    );
    return { deletedContainerIds, deletedLocalIds };
  });
}
