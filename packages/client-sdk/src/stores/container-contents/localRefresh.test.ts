import { expect, mock, test } from "bun:test";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import { ContainerStateMap } from "./containerStateMap";
import {
  type LocalContainerRefreshState,
  refreshLocalContainerStates,
} from "./localRefresh";

function createRefreshState(input: {
  containersById?: Map<string, ContainerState>;
  loadContainers: ContainerContentsPersistence["loadContainers"];
  log?: (message: string) => void;
  reconcileLocalRootContainer?: ContainerContentsPersistence["reconcileLocalRootContainer"];
  reconcileLocalSystemContainer?: ContainerContentsPersistence["reconcileLocalSystemContainer"];
}): LocalContainerRefreshState {
  const saveContainer: ContainerContentsPersistence["saveContainer"] = async (
    _execSql,
    container,
  ) => container;

  return {
    containersById: new ContainerStateMap(input.containersById),
    documentStoresNeedPriming: false,
    initialized: true,
    lifecycleGeneration: 0,
    localContainerRefreshGeneration: null,
    localContainerRefreshPromise: null,
    localContainerRefreshStructuralGeneration: null,
    localContainersNeedRefresh: true,
    persistence: {
      enqueuePendingUpdate: async () => {},
      ensureSchema: async () => {},
      loadContainers: input.loadContainers,
      reconcileLocalRootContainer:
        input.reconcileLocalRootContainer ?? (async () => {}),
      reconcileLocalSystemContainer:
        input.reconcileLocalSystemContainer ?? (async () => {}),
      saveContainer,
    } as unknown as ContainerContentsPersistence,
    runtime: {
      auth: { organizationId: "organization-id" },
      infra: {
        dbStatus: "ready",
        execSql: {} as ContainerContentsWorkflowRuntime["infra"]["execSql"],
      },
      util: {
        log: input.log ?? (() => {}),
      },
    } as ContainerContentsWorkflowRuntime,
    structuralGeneration: 0,
  };
}

function createTreeContainerState(input: {
  id: string;
  parentId: string | null;
  remote: boolean;
  systemSlot?: ContainerSystemSlot | null | undefined;
}): ContainerState {
  const documentId = input.remote ? `${input.id}-metadata` : null;
  return {
    container: {
      icon: null,
      id: input.id,
      metadataDocumentId: documentId,
      name: input.parentId === null ? "/" : "Contacts",
      organizationId: input.remote ? "organization-id" : "",
      parentId: input.parentId,
      systemSlot: input.systemSlot ?? null,
    },
    doc: {} as ContainerState["doc"],
    record: {
      accessEpoch: 1,
      accessStateHash: input.remote ? `${input.id}-access-state` : null,
      contentKeyBundle: null,
      documentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: input.id,
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

function createContainerState(documentId: string | null): ContainerState {
  return {
    container: {
      icon: null,
      id: "container-id",
      metadataDocumentId: documentId,
      name: "Contacts",
      organizationId: "organization-id",
      parentId: "root-id",
    },
    doc: {} as ContainerState["doc"],
    record: {
      accessEpoch: 1,
      accessStateHash: documentId ? "remote-access-state" : null,
      contentKeyBundle: null,
      documentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: "container-id",
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}

test("local container refresh waits for an in-flight refresh", async () => {
  type LoadContainersResult = Awaited<
    ReturnType<ContainerContentsPersistence["loadContainers"]>
  >;
  let resolveLoad: (value: LoadContainersResult) => void = () => {
    throw new Error("loadContainers promise was not initialized");
  };
  const loadContainers = mock(
    () =>
      new Promise<LoadContainersResult>((resolve) => {
        resolveLoad = resolve;
      }),
  );
  const state = createRefreshState({ loadContainers });
  const host = { updateSnapshot: mock(() => {}) };

  const firstRefresh = refreshLocalContainerStates({ host, state });
  const secondRefresh = refreshLocalContainerStates({ host, state });

  expect(secondRefresh).toBe(firstRefresh);
  await Promise.resolve();
  expect(loadContainers).toHaveBeenCalledTimes(1);
  resolveLoad([]);
  await Promise.all([firstRefresh, secondRefresh]);

  expect(host.updateSnapshot).toHaveBeenCalledTimes(1);
});

test("local refresh serializes replacement work after a lifecycle reset", async () => {
  type LoadContainersResult = Awaited<
    ReturnType<ContainerContentsPersistence["loadContainers"]>
  >;
  const resolvers: Array<(value: LoadContainersResult) => void> = [];
  let activeLoads = 0;
  let maxActiveLoads = 0;
  const loadContainers = mock(
    () =>
      new Promise<LoadContainersResult>((resolve) => {
        activeLoads += 1;
        maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
        resolvers.push((value) => {
          activeLoads -= 1;
          resolve(value);
        });
      }),
  );
  const state = createRefreshState({ loadContainers });
  const host = { updateSnapshot: mock(() => {}) };

  const staleRefresh = refreshLocalContainerStates({ host, state });
  await waitFor(() => resolvers.length === 1);

  state.lifecycleGeneration += 1;
  state.containersById = new Map();
  state.localContainersNeedRefresh = true;
  const replacementRefresh = refreshLocalContainerStates({ host, state });

  expect(loadContainers).toHaveBeenCalledTimes(1);
  resolvers[0]?.([]);
  await waitFor(() => resolvers.length === 2);

  expect(state.localContainerRefreshGeneration).toBe(1);
  expect(state.localContainerRefreshPromise).not.toBeNull();
  expect(host.updateSnapshot).not.toHaveBeenCalled();
  resolvers[1]?.([]);
  await Promise.all([staleRefresh, replacementRefresh]);

  expect(maxActiveLoads).toBe(1);
  expect(host.updateSnapshot).toHaveBeenCalledTimes(1);
  expect(state.localContainerRefreshPromise).toBeNull();
});

test("local container refresh logs failures without rejecting", async () => {
  const logMessages: string[] = [];
  const state = createRefreshState({
    loadContainers: async () => {
      throw new Error("database closed");
    },
    log: (message) => logMessages.push(message),
  });

  await expect(
    refreshLocalContainerStates({
      host: { updateSnapshot: () => {} },
      state,
    }),
  ).resolves.toBeUndefined();

  expect(logMessages[0]).toContain(
    "Failed to refresh local container states: database closed",
  );
  expect(state.localContainersNeedRefresh).toBe(true);
});

test("local container refresh does not downgrade remote state with a stale local-only load", async () => {
  type LoadContainersResult = Awaited<
    ReturnType<ContainerContentsPersistence["loadContainers"]>
  >;
  let resolveLoad: (value: LoadContainersResult) => void = () => {
    throw new Error("loadContainers promise was not initialized");
  };
  const loadContainers = mock(
    () =>
      new Promise<LoadContainersResult>((resolve) => {
        resolveLoad = resolve;
      }),
  );
  const currentState = createContainerState(null);
  const state = createRefreshState({
    containersById: new Map([[currentState.container.id, currentState]]),
    loadContainers,
  });

  const refresh = refreshLocalContainerStates({
    host: { updateSnapshot: () => {} },
    state,
  });
  await Promise.resolve();

  currentState.container.metadataDocumentId = "remote-document-id";
  currentState.record.documentId = "remote-document-id";
  resolveLoad([
    {
      container: createContainerState(null).container,
      record: createContainerState(null).record,
    },
  ]);
  await refresh;

  expect(currentState.container.metadataDocumentId).toBe("remote-document-id");
  expect(currentState.record.documentId).toBe("remote-document-id");
});

test("local container refresh preserves a live state inserted after its query starts", async () => {
  type LoadContainersResult = Awaited<
    ReturnType<ContainerContentsPersistence["loadContainers"]>
  >;
  let resolveLoad: (value: LoadContainersResult) => void = () => {
    throw new Error("loadContainers promise was not initialized");
  };
  const state = createRefreshState({
    loadContainers: () =>
      new Promise<LoadContainersResult>((resolve) => {
        resolveLoad = resolve;
      }),
  });
  const refresh = refreshLocalContainerStates({
    host: { updateSnapshot: () => {} },
    state,
  });
  await Promise.resolve();

  const liveState = createContainerState("live-metadata-document");
  state.containersById.set(liveState.container.id, liveState);
  const staleLoadedState = createContainerState("stale-metadata-document");
  resolveLoad([
    {
      container: staleLoadedState.container,
      record: staleLoadedState.record,
    },
  ]);
  await refresh;

  expect(state.containersById.get(liveState.container.id)).toBe(liveState);
  expect(liveState.record.documentId).toBe("live-metadata-document");
});

test("local container refresh does not resurrect state removed during its load", async () => {
  type LoadContainersResult = Awaited<
    ReturnType<ContainerContentsPersistence["loadContainers"]>
  >;
  let resolveLoad: (value: LoadContainersResult) => void = () => {
    throw new Error("loadContainers promise was not initialized");
  };
  const currentState = createContainerState("metadata-document");
  const state = createRefreshState({
    containersById: new Map([[currentState.container.id, currentState]]),
    loadContainers: () =>
      new Promise<LoadContainersResult>((resolve) => {
        resolveLoad = resolve;
      }),
  });
  const refresh = refreshLocalContainerStates({
    host: { updateSnapshot: () => {} },
    state,
  });
  await Promise.resolve();

  state.containersById.delete(currentState.container.id);
  resolveLoad([
    { container: currentState.container, record: currentState.record },
  ]);
  await refresh;

  expect(state.containersById.has(currentState.container.id)).toBe(false);
});

test("local container refresh does not resurrect an insert-delete ABA", async () => {
  type LoadContainersResult = Awaited<
    ReturnType<ContainerContentsPersistence["loadContainers"]>
  >;
  let resolveLoad: (value: LoadContainersResult) => void = () => {
    throw new Error("loadContainers promise was not initialized");
  };
  const state = createRefreshState({
    loadContainers: () =>
      new Promise<LoadContainersResult>((resolve) => {
        resolveLoad = resolve;
      }),
  });
  const refresh = refreshLocalContainerStates({
    host: { updateSnapshot: () => {} },
    state,
  });
  await Promise.resolve();

  const racedState = createContainerState("metadata-document");
  state.containersById.set(racedState.container.id, racedState);
  state.containersById.delete(racedState.container.id);
  resolveLoad([{ container: racedState.container, record: racedState.record }]);
  await refresh;

  expect(state.containersById.has(racedState.container.id)).toBe(false);
});

test("local refresh does not resurrect an initially absent tombstone", async () => {
  type LoadContainersResult = Awaited<
    ReturnType<ContainerContentsPersistence["loadContainers"]>
  >;
  let resolveLoad: (value: LoadContainersResult) => void = () => {
    throw new Error("loadContainers promise was not initialized");
  };
  const state = createRefreshState({
    loadContainers: () =>
      new Promise<LoadContainersResult>((resolve) => {
        resolveLoad = resolve;
      }),
  });
  const refresh = refreshLocalContainerStates({
    host: { updateSnapshot: () => {} },
    state,
  });
  await Promise.resolve();

  const staleLoadedState = createContainerState("metadata-document");
  state.containersById.delete(staleLoadedState.container.id);
  resolveLoad([
    {
      container: staleLoadedState.container,
      record: staleLoadedState.record,
    },
  ]);
  await refresh;

  expect(state.containersById.has(staleLoadedState.container.id)).toBe(false);
});

test("local container refresh does not overwrite pull progress saved during its load", async () => {
  type LoadContainersResult = Awaited<
    ReturnType<ContainerContentsPersistence["loadContainers"]>
  >;
  let resolveLoad: (value: LoadContainersResult) => void = () => {
    throw new Error("loadContainers promise was not initialized");
  };
  const loadContainers = mock(
    () =>
      new Promise<LoadContainersResult>((resolve) => {
        resolveLoad = resolve;
      }),
  );
  const currentState = createContainerState("remote-document-id");
  const state = createRefreshState({
    containersById: new Map([[currentState.container.id, currentState]]),
    loadContainers,
  });

  const refresh = refreshLocalContainerStates({
    host: { updateSnapshot: () => {} },
    state,
  });
  await Promise.resolve();

  const pullContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "metadata-page-2",
  };
  currentState.record = { ...currentState.record, pullContinuation };
  currentState.pullContinuation = pullContinuation;
  const staleState = createContainerState("remote-document-id");
  resolveLoad([{ container: staleState.container, record: staleState.record }]);
  await refresh;

  expect(currentState.record.pullContinuation).toEqual(pullContinuation);
  expect(currentState.pullContinuation).toEqual(pullContinuation);
});

test("local container refresh applies an intentional remote reset", async () => {
  const currentState = createContainerState("remote-document-id");
  const resetState = createContainerState(null);
  const state = createRefreshState({
    containersById: new Map([[currentState.container.id, currentState]]),
    loadContainers: async () => [
      { container: resetState.container, record: resetState.record },
    ],
  });

  await refreshLocalContainerStates({
    host: { updateSnapshot: () => {} },
    state,
  });

  expect(currentState.container.metadataDocumentId).toBeNull();
  expect(currentState.record.documentId).toBeNull();
});

test("local refresh reconciles roots and system children loaded after remote state", async () => {
  const systemSlot =
    "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ContainerSystemSlot;
  const remoteRoot = createTreeContainerState({
    id: "remote-root",
    parentId: null,
    remote: true,
  });
  const remoteSystem = createTreeContainerState({
    id: "remote-contacts",
    parentId: remoteRoot.container.id,
    remote: true,
    systemSlot,
  });
  const localRoot = createTreeContainerState({
    id: "local-root",
    parentId: null,
    remote: false,
  });
  const localSystem = createTreeContainerState({
    id: "local-contacts",
    parentId: localRoot.container.id,
    remote: false,
    systemSlot,
  });
  const rootReconciliations = mock(async () => {});
  const systemReconciliations = mock(async () => {});
  const state = createRefreshState({
    containersById: new Map([
      [remoteRoot.container.id, remoteRoot],
      [remoteSystem.container.id, remoteSystem],
    ]),
    loadContainers: async () => [
      { container: localRoot.container, record: null },
      { container: localSystem.container, record: null },
    ],
    reconcileLocalRootContainer: rootReconciliations,
    reconcileLocalSystemContainer: systemReconciliations,
  });

  await refreshLocalContainerStates({
    host: { updateSnapshot: () => {} },
    state,
  });

  expect(Array.from(state.containersById.keys()).sort()).toEqual([
    "remote-contacts",
    "remote-root",
  ]);
  expect(rootReconciliations).toHaveBeenCalledTimes(1);
  expect(systemReconciliations).toHaveBeenCalledTimes(1);
});
