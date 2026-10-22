import { listDocumentLocalIdsPlacedOnlyIn } from "../../../workflows/container-contents/containerPersistence";
import {
  defaultDocumentsPersistence,
  deletePersistedDocument,
  reclaimDocumentOrphanBlobs,
} from "../../../workflows/documents";
import { isRetainedWhileSyncPaused } from "../../../workflows/sync";
import { emitPersistedDocumentDeletion } from "../../documents/registry";
import type { ContainerWriteGuard } from "../remoteWrites/writeGeneration";
import { updateContainerContentsSnapshot } from "../state";
import type { ContainerContentsStoreState } from "../types";

/** The local containers forgetting an organization's content removes. */
function listForgettableOrganizationContainerIds(
  state: Pick<ContainerContentsStoreState, "containersById">,
  organizationId: string,
): string[] {
  return [...state.containersById.values()].flatMap(({ container }) =>
    container.organizationId === organizationId &&
    !isRetainedWhileSyncPaused(container)
      ? [container.id]
      : [],
  );
}

/**
 * Removes one organization's content from this device after its sync was
 * paused: every container except its retained metadata root, and every
 * document placed only in those containers. Nothing changes on the server, so
 * resuming downloads it again. The caller has already confirmed the
 * organization has no unsynced local writes; this removes documents without
 * per-record guards.
 */
async function forgetOrganizationContent(
  state: ContainerContentsStoreState,
  organizationId: string,
  isCurrent: ContainerWriteGuard,
): Promise<boolean> {
  if (state.runtime.infra.dbStatus !== "ready" || !state.snapshot.ready) {
    return false;
  }
  const containerIds = listForgettableOrganizationContainerIds(
    state,
    organizationId,
  );
  if (containerIds.length === 0) return true;
  const { documentProjectors, execSql } = state.runtime.infra;
  await state.persistence.ensureSchema(execSql);

  const localIds = await listDocumentLocalIdsPlacedOnlyIn(
    execSql,
    containerIds,
  );
  for (const localId of localIds) {
    if (!isCurrent()) return false;
    const deleted = await deletePersistedDocument({
      documentProjectors,
      execSql,
      localId,
      persistence: defaultDocumentsPersistence,
    });
    if (deleted) {
      emitPersistedDocumentDeletion(state.runtime.state.domainScope, localId);
    }
  }
  if (localIds.length > 0) void reclaimDocumentOrphanBlobs(state.runtime);
  if (!isCurrent()) return false;

  const removedAt = new Date().toISOString();
  const deletedContainerIds = await state.persistence.deleteContainers(
    execSql,
    containerIds.map((containerId) => ({
      containerId,
      reason: "access_revoked",
      updatedAt: removedAt,
    })),
    { stillCurrent: isCurrent },
  );
  for (const containerId of deletedContainerIds) {
    state.containersById.delete(containerId);
  }
  if (deletedContainerIds.length > 0 && state.initialized) {
    updateContainerContentsSnapshot(state);
  }
  return deletedContainerIds.length === containerIds.length;
}

type ContainerWriteChain = (
  state: ContainerContentsStoreState,
  work: (isCurrent: () => boolean) => ContainerContentsStoreState["writeChain"],
  changedIds: readonly string[],
) => ContainerContentsStoreState["writeChain"];

/** Runs `forgetOrganizationContent` in the store's container write chain. */
export function createForgetOrganizationContentMethod(
  state: ContainerContentsStoreState,
  chainContainerWrite: ContainerWriteChain,
): (organizationId: string) => Promise<boolean> {
  return async (organizationId) => {
    let forgotten = false;
    await chainContainerWrite(
      state,
      async (isCurrent) => {
        forgotten = await forgetOrganizationContent(
          state,
          organizationId,
          isCurrent,
        );
        return null;
      },
      listForgettableOrganizationContainerIds(state, organizationId),
    );
    return forgotten;
  };
}
