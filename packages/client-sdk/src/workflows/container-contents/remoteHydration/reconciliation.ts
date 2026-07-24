import type { LocalRootDescendantReparentInput } from "../containerPersistence";
import {
  createContainerChildIndex,
  moveIndexedContainerChild,
  removeIndexedContainerChild,
} from "./childIndex";
import type {
  ContainerChildIndex,
  ContainerState,
  RemoteContainerHydrationState,
} from "./types";

function hasRemoteContainerMetadataState(
  containerState: ContainerState,
): boolean {
  return (
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0 &&
    typeof containerState.container.metadataDocumentId === "string" &&
    containerState.container.metadataDocumentId.length > 0
  );
}

function isLocalOnlyRootContainerState(
  containerState: ContainerState,
): boolean {
  return (
    containerState.container.parentId === null &&
    !hasRemoteContainerMetadataState(containerState)
  );
}

function canUseRemoteRootAsLocalRootReconciliationTarget(input: {
  remoteRootState: ContainerState;
  state: RemoteContainerHydrationState;
}): boolean {
  const { remoteRootState, state } = input;
  return (
    remoteRootState.container.parentId === null &&
    (!state.runtime.auth.organizationId ||
      remoteRootState.container.organizationId ===
        state.runtime.auth.organizationId)
  );
}

function collectContainerSubtreeStates(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  containersById: ReadonlyMap<string, ContainerState>;
  rootContainerId: string;
}): ContainerState[] {
  const { childIdsByParentId, containersById, rootContainerId } = input;
  const subtreeStates: ContainerState[] = [];
  const pendingContainerIds = [rootContainerId];
  const enqueuedContainerIds = new Set<string>([rootContainerId]);
  const index = childIdsByParentId ?? createContainerChildIndex(containersById);

  while (pendingContainerIds.length > 0) {
    const containerId = pendingContainerIds.pop();
    if (!containerId) {
      continue;
    }

    const childIds = index.get(containerId);
    if (!childIds) {
      continue;
    }

    for (const childId of childIds) {
      if (enqueuedContainerIds.has(childId)) {
        continue;
      }
      const childState = containersById.get(childId);
      if (!childState) {
        continue;
      }

      enqueuedContainerIds.add(childId);
      subtreeStates.push(childState);
      pendingContainerIds.push(childId);
    }
  }

  return subtreeStates;
}

function buildLocalRootDescendantReparents(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  localRootState: ContainerState;
  remoteRootState: ContainerState;
  state: RemoteContainerHydrationState;
}): {
  descendantReparents: LocalRootDescendantReparentInput[];
  descendants: ContainerState[];
} {
  const { childIdsByParentId, localRootState, remoteRootState, state } = input;
  const descendants = collectContainerSubtreeStates({
    childIdsByParentId,
    containersById: state.containersById,
    rootContainerId: localRootState.container.id,
  });
  const descendantReparents = descendants.map((descendant) => {
    const previousParentId = descendant.container.parentId;
    const parentContainerId =
      previousParentId === localRootState.container.id
        ? remoteRootState.container.id
        : previousParentId;

    return {
      containerId: descendant.container.id,
      parentContainerId,
      updateCreateIntent: !descendant.record.documentId && !!parentContainerId,
    };
  });

  return { descendantReparents, descendants };
}

function applyLocalRootDescendantReparents(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  descendantReparents: ReadonlyArray<LocalRootDescendantReparentInput>;
  descendants: ReadonlyArray<ContainerState>;
  remoteRootState: ContainerState;
  updatedAt: string;
}): void {
  const {
    childIdsByParentId,
    descendantReparents,
    descendants,
    remoteRootState,
    updatedAt,
  } = input;
  const reparentByContainerId = new Map(
    descendantReparents.map((reparent) => [reparent.containerId, reparent]),
  );

  for (const descendant of descendants) {
    const previousParentId = descendant.container.parentId;
    const reparent = reparentByContainerId.get(descendant.container.id);
    if (!reparent) {
      continue;
    }

    descendant.container = {
      ...descendant.container,
      organizationId: remoteRootState.container.organizationId,
      parentId: reparent.parentContainerId,
      localUpdatedAt: updatedAt,
      updatedAt: descendant.container.serverUpdatedAt ?? updatedAt,
    };
    moveIndexedContainerChild(
      childIdsByParentId,
      descendant.container.id,
      previousParentId,
      reparent.parentContainerId,
    );
  }
}

async function reconcileLocalOnlyRootContainer(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  localRootState: ContainerState;
  remoteRootState: ContainerState;
  state: RemoteContainerHydrationState;
}): Promise<void> {
  const { childIdsByParentId, localRootState, remoteRootState, state } = input;
  const execSql = state.runtime.infra.execSql;
  const updatedAt = new Date().toISOString();
  const { descendantReparents, descendants } =
    buildLocalRootDescendantReparents({
      childIdsByParentId,
      localRootState,
      remoteRootState,
      state,
    });

  await state.persistence.reconcileLocalRootContainer(execSql, {
    descendantReparents,
    localRootContainerId: localRootState.container.id,
    remoteOrganizationId: remoteRootState.container.organizationId,
    remoteRootContainerId: remoteRootState.container.id,
    updatedAt,
  });
  applyLocalRootDescendantReparents({
    childIdsByParentId,
    descendantReparents,
    descendants,
    remoteRootState,
    updatedAt,
  });

  if (childIdsByParentId) {
    removeIndexedContainerChild(
      childIdsByParentId,
      localRootState.container.id,
      localRootState.container.parentId,
    );
    childIdsByParentId.delete(localRootState.container.id);
  }
  state.containersById.delete(localRootState.container.id);
  state.runtime.util.log(
    `Container contents: reconciled local root ${localRootState.container.id} into remote root ${remoteRootState.container.id}`,
  );
}

export async function reconcileLocalOnlyRootContainers(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  requestDocumentPriming?: (() => void) | undefined;
  remoteRootState: ContainerState;
  state: RemoteContainerHydrationState;
}): Promise<number> {
  const { childIdsByParentId, remoteRootState, state } = input;
  if (
    !canUseRemoteRootAsLocalRootReconciliationTarget({
      remoteRootState,
      state,
    })
  ) {
    return 0;
  }

  const localRootStates = Array.from(state.containersById.values()).filter(
    (containerState) =>
      containerState.container.id !== remoteRootState.container.id &&
      isLocalOnlyRootContainerState(containerState),
  );

  for (const localRootState of localRootStates) {
    await reconcileLocalOnlyRootContainer({
      childIdsByParentId,
      localRootState,
      remoteRootState,
      state,
    });
  }
  // A remote system child can be applied before its remote root (for example,
  // from an earlier page/pass). Its local twin does not match while it is still
  // parented to the pre-auth root. Root reconciliation fixes the parent and
  // organization, so retry every already-known remote system sibling now. The
  // normal root-first ordering still reconciles when the remote system arrives.
  let reconciledSystemContainerCount = 0;
  for (const knownRemoteSystemState of Array.from(
    state.containersById.values(),
  )) {
    if (
      (knownRemoteSystemState.container.systemSlot ?? null) !== null &&
      hasRemoteContainerMetadataState(knownRemoteSystemState)
    ) {
      reconciledSystemContainerCount +=
        await reconcileLocalOnlySystemContainers({
          childIdsByParentId,
          remoteSystemState: knownRemoteSystemState,
          state,
        });
    }
  }
  if (localRootStates.length + reconciledSystemContainerCount > 0) {
    input.requestDocumentPriming?.();
  }

  return localRootStates.length;
}

function isLocalOnlySystemContainerState(input: {
  containerState: ContainerState;
  remoteSystemState: ContainerState;
  state: RemoteContainerHydrationState;
}): boolean {
  const { containerState, remoteSystemState, state } = input;
  const localSystemSlot = containerState.container.systemSlot ?? null;
  const remoteSystemSlot = remoteSystemState.container.systemSlot ?? null;

  if (
    remoteSystemSlot === null ||
    localSystemSlot !== remoteSystemSlot ||
    containerState.container.id === remoteSystemState.container.id ||
    hasRemoteContainerMetadataState(containerState)
  ) {
    return false;
  }

  const sharesRemoteLocation =
    containerState.container.organizationId ===
      remoteSystemState.container.organizationId &&
    containerState.container.parentId === remoteSystemState.container.parentId;
  if (sharesRemoteLocation) {
    return true;
  }

  const homeOrganizationId = state.runtime.auth.organizationId;
  if (
    !homeOrganizationId ||
    remoteSystemState.container.organizationId !== homeOrganizationId ||
    containerState.container.organizationId !== ""
  ) {
    return false;
  }

  const localParentId = containerState.container.parentId;
  const localParentState = localParentId
    ? state.containersById.get(localParentId)
    : null;

  return !localParentState || isLocalOnlyRootContainerState(localParentState);
}

function findLocalOnlySystemContainerStates(input: {
  remoteSystemState: ContainerState;
  state: RemoteContainerHydrationState;
}): ContainerState[] {
  const { remoteSystemState, state } = input;
  if ((remoteSystemState.container.systemSlot ?? null) === null) {
    return [];
  }

  return Array.from(state.containersById.values()).filter((containerState) =>
    isLocalOnlySystemContainerState({
      containerState,
      remoteSystemState,
      state,
    }),
  );
}

function applyLocalSystemContainerChildReparents(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  localSystemState: ContainerState;
  remoteSystemState: ContainerState;
  state: RemoteContainerHydrationState;
  updatedAt: string;
}): void {
  const { childIdsByParentId, localSystemState, remoteSystemState, state } =
    input;
  const localContainerId = localSystemState.container.id;
  const childContainerIds = childIdsByParentId
    ? Array.from(childIdsByParentId.get(localContainerId) ?? [])
    : Array.from(state.containersById.values()).flatMap((containerState) =>
        containerState.container.parentId === localContainerId
          ? [containerState.container.id]
          : [],
      );

  for (const childContainerId of childContainerIds) {
    const childState = state.containersById.get(childContainerId);
    if (!childState) {
      continue;
    }

    const previousParentId = childState.container.parentId;
    childState.container = {
      ...childState.container,
      organizationId: remoteSystemState.container.organizationId,
      parentId: remoteSystemState.container.id,
      localUpdatedAt: input.updatedAt,
      updatedAt: childState.container.serverUpdatedAt ?? input.updatedAt,
    };
    moveIndexedContainerChild(
      childIdsByParentId,
      childState.container.id,
      previousParentId,
      remoteSystemState.container.id,
    );
  }
}

async function reconcileLocalOnlySystemContainer(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  localSystemState: ContainerState;
  remoteSystemState: ContainerState;
  state: RemoteContainerHydrationState;
}): Promise<void> {
  const { childIdsByParentId, localSystemState, remoteSystemState, state } =
    input;
  const updatedAt = new Date().toISOString();
  const execSql = state.runtime.infra.execSql;

  await state.persistence.reconcileLocalSystemContainer(execSql, {
    localContainerId: localSystemState.container.id,
    remoteContainerId: remoteSystemState.container.id,
    remoteOrganizationId: remoteSystemState.container.organizationId,
    updatedAt,
  });
  applyLocalSystemContainerChildReparents({
    childIdsByParentId,
    localSystemState,
    remoteSystemState,
    state,
    updatedAt,
  });

  if (childIdsByParentId) {
    removeIndexedContainerChild(
      childIdsByParentId,
      localSystemState.container.id,
      localSystemState.container.parentId,
    );
    childIdsByParentId.delete(localSystemState.container.id);
  }
  state.containersById.delete(localSystemState.container.id);
  state.runtime.util.log(
    `Container contents: reconciled local system container ${localSystemState.container.id} into remote system container ${remoteSystemState.container.id}`,
  );
}

export async function reconcileLocalOnlySystemContainers(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  requestDocumentPriming?: (() => void) | undefined;
  remoteSystemState: ContainerState;
  state: RemoteContainerHydrationState;
}): Promise<number> {
  const { childIdsByParentId, remoteSystemState, state } = input;
  const localSystemStates = findLocalOnlySystemContainerStates({
    remoteSystemState,
    state,
  });

  for (const localSystemState of localSystemStates) {
    await reconcileLocalOnlySystemContainer({
      childIdsByParentId,
      localSystemState,
      remoteSystemState,
      state,
    });
  }
  if (localSystemStates.length > 0) {
    input.requestDocumentPriming?.();
  }

  return localSystemStates.length;
}
