import { removeOrganizationContentUnlessPending } from "../../../workflows/container-contents/syncPause/documentRemoval";
import { reclaimDocumentOrphanBlobs } from "../../../workflows/documents";
import { isRetainedWhileSyncPaused } from "../../../workflows/sync";
import {
  emitPersistedDocumentDeletion,
  hasRegisteredDocumentStore,
} from "../../documents/registry";
import type { ContainerWriteGuard } from "../remoteWrites/writeGeneration";
import { updateContainerContentsSnapshot } from "../state";
import type {
  ContainerContentsStoreState,
  OrganizationContentForgetOutcome,
} from "../types";

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
 * while any of its documents is open this session. It also refuses the
 * session's active organization, whose root the session still writes to.
 */
async function forgetOrganizationContent(
  state: ContainerContentsStoreState,
  organizationId: string,
  isCurrent: ContainerWriteGuard,
): Promise<OrganizationContentForgetOutcome> {
  if (state.runtime.infra.dbStatus !== "ready" || !state.snapshot.ready) {
    return "retry";
  }
  if (state.runtime.auth.organizationId === organizationId) return "retry";
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
    isDocumentOpen: (localId) =>
      hasRegisteredDocumentStore(domainScope, localId),
    organizationId,
  });
  for (const localId of removal.deletedLocalIds) {
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
  switch (removal.status) {
    case "removed":
      return "removed";
    // Stores stay registered for the session, so retrying cannot succeed
    // before the next session.
    case "open-documents":
      return "next-session";
    case "pending-writes":
    case "interrupted":
      return "retry";
  }
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
): (organizationId: string) => Promise<OrganizationContentForgetOutcome> {
  return async (organizationId) => {
    let outcome: OrganizationContentForgetOutcome = "retry";
    await chainContainerWrite(
      state,
      async (isCurrent) => {
        outcome = await forgetOrganizationContent(
          state,
          organizationId,
          isCurrent,
        );
        return null;
      },
      listForgettableOrganizationContainerIds(state, organizationId),
    );
    return outcome;
  };
}
