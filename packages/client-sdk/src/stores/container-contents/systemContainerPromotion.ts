import { base64ToBytes } from "@symcrypt/encoding";
import { enqueuePendingContainerUpdate } from "../../workflows/container-contents/containerPersistence";
import { updateContainerContentsSnapshot } from "./state";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import type {
  ContainerContentsStoreState,
  EnsureSystemContainerOptions,
} from "./types";

export function hasAdvancedManagedPrincipalReference(
  containerState: ContainerState,
): boolean {
  return (
    containerState.metadataReferencedPrincipals?.some(
      (principal) => principal.version > 1,
    ) ?? false
  );
}

export async function promoteExistingLocalSystemContainerSync(input: {
  containerState: ContainerState;
  logLabel: string;
  options: EnsureSystemContainerOptions;
  rootState: ContainerState | null;
  state: ContainerContentsStoreState;
  syncAgent: ContainerContentsStoreSyncAgent;
}): Promise<void> {
  const { containerState, options, rootState, state, syncAgent } = input;
  const parentContainerId = containerState.container.parentId;
  if (
    options.deferRemoteSync ||
    !state.runtime.auth.isAuthenticated ||
    !parentContainerId ||
    containerState.record.documentId
  ) {
    return;
  }

  if (
    options.skipAdvancedManagedRoot &&
    rootState &&
    hasAdvancedManagedPrincipalReference(rootState)
  ) {
    return;
  }

  const execSql = state.runtime.infra.execSql;
  const [pendingCreateIntents, pendingUpdates] = await Promise.all([
    state.persistence.listPendingCreateIntents(execSql),
    state.persistence.listPendingUpdates(execSql, containerState.container.id),
  ]);
  const hasPendingCreateIntent = pendingCreateIntents.some(
    (intent) => intent.containerId === containerState.container.id,
  );
  const shouldQueueCreateIntent = !hasPendingCreateIntent;
  const shouldQueueMetadataUpdate = pendingUpdates.length === 0;
  if (!shouldQueueCreateIntent && !shouldQueueMetadataUpdate) {
    return;
  }

  if (shouldQueueCreateIntent) {
    containerState.container = await state.persistence.saveContainer(
      execSql,
      containerState.container,
      containerState.record,
      { createIntent: { parentContainerId } },
    );
    updateContainerContentsSnapshot(state);
  }

  if (shouldQueueMetadataUpdate) {
    await enqueuePendingContainerUpdate(execSql, state.persistence, {
      containerId: containerState.container.id,
      update: base64ToBytes(containerState.record.metadataUpdates),
    });
  }

  syncAgent.scheduleSync();
  state.runtime.util.log(
    `${input.logLabel}: queued system container "${containerState.container.systemSlot ?? containerState.container.id}" for remote sync`,
  );
}
