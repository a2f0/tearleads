import { removeOrganizationContentUnlessPending } from "../../../workflows/container-contents/syncPause/documentRemoval";
import { reclaimDocumentOrphanBlobs } from "../../../workflows/documents";
import {
  getOrCreateOrganizationSyncPauses,
  isRetainedWhileSyncPaused,
} from "../../../workflows/sync";
import {
  emitPersistedDocumentDeletion,
  hasQueuedDocumentStoreWrites,
  retireDocumentStore,
} from "../../documents/registry";
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
 * resuming downloads it again.
 *
 * Unsynced work is never removed: the removal refuses while any pending write
 * touches the organization, checked under the same lock as the deletions, and
 * while an open store holds edits for any of its documents that have not
 * reached SQLite. It also refuses the session's active organization, whose
 * root the session still writes to. Returns whether nothing is left to retry.
 */
async function forgetOrganizationContent(
  state: ContainerContentsStoreState,
  organizationId: string,
  isCurrent: ContainerWriteGuard,
): Promise<boolean> {
  if (state.runtime.infra.dbStatus !== "ready" || !state.snapshot.ready) {
    return false;
  }
  if (state.runtime.auth.organizationId === organizationId) return false;
  const containerIds = listForgettableOrganizationContainerIds(
    state,
    organizationId,
  );
  const { documentProjectors, execSql } = state.runtime.infra;
  const { domainScope } = state.runtime.state;
  // Switching into the organization mid-removal stops it before any deletion.
  const stillCurrent = () =>
    isCurrent() && state.runtime.auth.organizationId !== organizationId;
  await state.persistence.ensureSchema(execSql);
  const removal = await removeOrganizationContentUnlessPending({
    containerIds,
    deleteContainers: (lockedExecSql, removals) =>
      state.persistence.deleteContainers(lockedExecSql, removals, {
        stillCurrent,
      }),
    documentProjectors,
    execSql,
    hasQueuedWrites: (localId) =>
      hasQueuedDocumentStoreWrites(domainScope, localId),
    organizationId,
  });
  const pauses = getOrCreateOrganizationSyncPauses(domainScope);
  for (const localId of removal.deletedLocalIds) {
    retireDocumentStore(domainScope, localId, () =>
      pauses.isOrganizationPaused(organizationId),
    );
    emitPersistedDocumentDeletion(domainScope, localId);
  }
  if (removal.deletedLocalIds.length > 0) {
    void reclaimDocumentOrphanBlobs(state.runtime);
  }
  for (const containerId of removal.deletedContainerIds) {
    state.containersById.delete(containerId);
  }
  if (removal.deletedContainerIds.length > 0 && state.initialized) {
    updateContainerContentsSnapshot(state);
  }
  return removal.status === "removed";
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
