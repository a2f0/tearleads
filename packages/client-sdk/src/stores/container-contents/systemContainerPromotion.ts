import { base64ToBytes } from "@tearleads/encoding";
import { enqueuePendingContainerUpdate } from "../../workflows/container-contents/containerPersistence";
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
  persistCreateIntent: (
    containerState: ContainerState,
    parentContainerId: string,
  ) => Promise<boolean>;
  rootState: ContainerState | null;
  state: ContainerContentsStoreState;
  syncAgent: ContainerContentsStoreSyncAgent;
}): Promise<boolean> {
  const { containerState, options, rootState, state, syncAgent } = input;
  const parentContainerId = containerState.container.parentId;
  if (
    options.deferRemoteSync ||
    !state.runtime.auth.isAuthenticated ||
    !parentContainerId ||
    containerState.record.documentId
  ) {
    return true;
  }

  if (
    options.skipAdvancedManagedRoot &&
    rootState &&
    hasAdvancedManagedPrincipalReference(rootState)
  ) {
    return true;
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
    return true;
  }

  if (shouldQueueCreateIntent) {
    const persisted = await input.persistCreateIntent(
      containerState,
      parentContainerId,
    );
    if (!persisted) {
      return false;
    }
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
  return true;
}
