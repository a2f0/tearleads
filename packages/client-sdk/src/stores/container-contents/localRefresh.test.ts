import { expect, mock, test } from "bun:test";
import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
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
    containersById: input.containersById ?? new Map(),
    documentStoresNeedPriming: false,
    initialized: true,
    localContainerRefreshPromise: null,
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
