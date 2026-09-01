import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import type { CreatedChildContainerState } from "../../workflows/container-contents/container-state/types";
import { isRemoteBackedContainerState } from "./remoteBackedContainerState";
import { updateContainerContentsSnapshot } from "./state";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import {
  findRootContainerState,
  findSystemContainerStateForRoot,
} from "./systemContainerLookup";
import type { ContainerContentsStoreState } from "./types";
import type { ContainerWriteGuard } from "./writeGeneration";

function findSystemContainerCreatedAfterRemoteHydrationTarget(
  state: ContainerContentsStoreState,
  systemSlot: ContainerSystemSlot,
  created: ContainerState,
): ContainerState | null {
  if (isRemoteBackedContainerState(created)) {
    return null;
  }

  const currentRoot = findRootContainerState(state);
  const remoteTarget = findSystemContainerStateForRoot(
    state,
    systemSlot,
    currentRoot,
  );
  if (
    !remoteTarget ||
    remoteTarget.container.id === created.container.id ||
    !isRemoteBackedContainerState(remoteTarget)
  ) {
    return null;
  }

  return remoteTarget;
}

function findCreatedSystemContainerRebaseRoot(input: {
  created: CreatedChildContainerState;
  state: ContainerContentsStoreState;
}): ContainerState | null {
  const { containerState } = input.created;
  const currentRoot = findRootContainerState(input.state);
  if (
    !currentRoot ||
    !isRemoteBackedContainerState(currentRoot) ||
    (containerState.container.parentId === currentRoot.container.id &&
      containerState.container.organizationId ===
        currentRoot.container.organizationId)
  ) {
    return null;
  }
  return currentRoot;
}

async function rebaseCreatedSystemContainerOntoRemoteRoot(input: {
  created: CreatedChildContainerState;
  isCurrent: ContainerWriteGuard;
  remoteRoot: ContainerState;
  state: ContainerContentsStoreState;
}): Promise<void> {
  const { created, remoteRoot, state } = input;
  const containerState = created.containerState;
  const rebasedContainer = {
    ...containerState.container,
    organizationId: remoteRoot.container.organizationId,
    parentId: remoteRoot.container.id,
  };
  const persistedContainer = await state.persistence.saveContainer(
    state.runtime.infra.execSql,
    rebasedContainer,
    containerState.record,
    {
      ...(created.shouldRequestSync
        ? { createIntent: { parentContainerId: remoteRoot.container.id } }
        : {}),
      stillCurrent: input.isCurrent,
    },
  );
  if (!input.isCurrent()) return;
  containerState.container = persistedContainer;
}

async function reconcileCreatedSystemContainerIntoTarget(input: {
  created: CreatedChildContainerState;
  isCurrent: ContainerWriteGuard;
  remoteTarget: ContainerState;
  state: ContainerContentsStoreState;
}): Promise<void> {
  if (!input.isCurrent()) return;
  await input.state.persistence.reconcileLocalSystemContainer(
    input.state.runtime.infra.execSql,
    {
      localContainerId: input.created.containerState.container.id,
      remoteContainerId: input.remoteTarget.container.id,
      remoteOrganizationId: input.remoteTarget.container.organizationId,
      stillCurrent: input.isCurrent,
    },
  );
}

export async function finalizeCreatedSystemContainer(input: {
  created: CreatedChildContainerState;
  logLabel: string;
  state: ContainerContentsStoreState;
  syncAgent: ContainerContentsStoreSyncAgent;
  systemSlot: ContainerSystemSlot;
  isCurrent?: ContainerWriteGuard | undefined;
}): Promise<{ adopted: boolean; containerState: ContainerState } | null> {
  const { created, state, syncAgent, systemSlot } = input;
  const isCurrent = input.isCurrent ?? (() => true);
  // Keep the no-target check and local insertion in one synchronous turn. If
  // we yielded between them, remote root hydration could delete the captured
  // parent in that gap and this create would land as an orphan afterward.
  let remoteTarget = findSystemContainerCreatedAfterRemoteHydrationTarget(
    state,
    systemSlot,
    created.containerState,
  );
  if (remoteTarget) {
    await reconcileCreatedSystemContainerIntoTarget({
      created,
      isCurrent,
      remoteTarget,
      state,
    });
    return isCurrent() ? { adopted: true, containerState: remoteTarget } : null;
  }

  // The remote root can arrive before its system child. Rebase the persisted
  // candidate now so that a later same-slot child matches normal reconciliation
  // instead of leaving the candidate under the deleted pre-auth root.
  const remoteRoot = findCreatedSystemContainerRebaseRoot({ created, state });
  if (remoteRoot) {
    await rebaseCreatedSystemContainerOntoRemoteRoot({
      created,
      isCurrent,
      remoteRoot,
      state,
    });
    if (!isCurrent()) return null;
    remoteTarget = findSystemContainerCreatedAfterRemoteHydrationTarget(
      state,
      systemSlot,
      created.containerState,
    );
    if (remoteTarget) {
      await reconcileCreatedSystemContainerIntoTarget({
        created,
        isCurrent,
        remoteTarget,
        state,
      });
      return isCurrent()
        ? { adopted: true, containerState: remoteTarget }
        : null;
    }
  }

  if (!isCurrent()) return null;
  state.containersById.set(
    created.containerState.container.id,
    created.containerState,
  );
  updateContainerContentsSnapshot(state);
  if (created.shouldRequestSync) {
    syncAgent.scheduleSync();
  }
  state.runtime.util.log(
    `${input.logLabel}: ensured system container "${systemSlot}"`,
  );
  return { adopted: false, containerState: created.containerState };
}
