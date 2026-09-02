import { expect, mock, test } from "bun:test";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import { ContainerStateMap } from "./containerStateMap";
import {
  type LocalContainerRefreshState,
  refreshLocalContainerStates,
} from "./localRefresh";

function loadedContainer(documentId: string, name: string): ContainerState {
  return {
    container: {
      icon: null,
      id: "container-id",
      metadataDocumentId: documentId,
      name,
      organizationId: "organization-id",
      parentId: "root-id",
    },
    doc: {} as ContainerState["doc"],
    record: {
      accessEpoch: 1,
      accessStateHash: "access-state",
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

test("local refresh retries replacement persistence after a structural change", async () => {
  type Loaded = Awaited<
    ReturnType<ContainerContentsPersistence["loadContainers"]>
  >;
  let resolveStaleLoad: (value: Loaded) => void = () => {
    throw new Error("stale local load was not initialized");
  };
  const staleLoad = mock(
    () =>
      new Promise<Loaded>((resolve) => {
        resolveStaleLoad = resolve;
      }),
  );
  const replacementLoad = mock(async () => [
    loadedContainer("replacement-document", "Replacement"),
  ]);
  const persistence = {
    ensureSchema: async () => {},
    loadContainers: staleLoad,
    saveContainer: async (
      _execSql: unknown,
      container: ContainerState["container"],
    ) => container,
  } as unknown as ContainerContentsPersistence;
  const state: LocalContainerRefreshState = {
    containersById: new ContainerStateMap(),
    documentStoresNeedPriming: false,
    initialized: true,
    lifecycleGeneration: 0,
    localContainerRefreshGeneration: null,
    localContainerRefreshPromise: null,
    localContainerRefreshStructuralGeneration: null,
    localContainersNeedRefresh: true,
    persistence,
    runtime: {
      auth: { organizationId: "organization-id" },
      infra: { dbStatus: "ready", execSql: async () => [] },
      util: { log: () => {} },
    } as unknown as ContainerContentsWorkflowRuntime,
    structuralGeneration: 0,
  };
  const host = { updateSnapshot: mock(() => {}) };

  const refresh = refreshLocalContainerStates({ host, state });
  for (let attempt = 0; staleLoad.mock.calls.length === 0; attempt += 1) {
    if (attempt === 100) throw new Error("stale local load did not start");
    await Bun.sleep(1);
  }
  state.structuralGeneration += 1;
  state.persistence = { ...persistence, loadContainers: replacementLoad };
  resolveStaleLoad([loadedContainer("stale-document", "Stale")]);
  await refresh;

  expect(replacementLoad).toHaveBeenCalledTimes(1);
  expect(state.containersById.get("container-id")?.record.documentId).toBe(
    "replacement-document",
  );
  expect(state.containersById.get("container-id")?.container.name).toBe(
    "Replacement",
  );
  expect(host.updateSnapshot).toHaveBeenCalledTimes(1);
});
