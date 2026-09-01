import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import type { DomainScope } from "../../data/domainScope";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { deleteContainer } from "./operations";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
  updateContainerContentsStoreRuntime,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
import { captureContainerWriteGeneration } from "./writeGeneration";

test("remote deletion reconciles the replacement executor after a mid-request swap", async () => {
  const originalDatabase = await createTestExecSql(
    "container-delete-original-executor",
  );
  const replacementDatabase = await createTestExecSql(
    "container-delete-replacement-executor",
  );
  let resolveDelete!: (value: {
    data: { containerId: string; deletedAt: string };
    ok: true;
  }) => void;
  let markDeleteStarted!: () => void;
  const deleteStarted = new Promise<void>((resolve) => {
    markDeleteStarted = resolve;
  });
  const deleteResponse = new Promise<{
    data: { containerId: string; deletedAt: string };
    ok: true;
  }>((resolve) => {
    resolveDelete = resolve;
  });
  const apiClient = createMockApiClient({
    deleteContainerResult: async () => {
      markDeleteStarted();
      return deleteResponse;
    },
  });
  const source = createTestContainerState({
    id: "source",
    organizationId: "org-1",
    parentId: "parent",
  });

  try {
    for (const execSql of [
      originalDatabase.execSql,
      replacementDatabase.execSql,
    ]) {
      await defaultContainerContentsPersistence.ensureSchema(execSql);
      await defaultContainerContentsPersistence.saveContainer(
        execSql,
        source.container,
        source.record,
      );
    }
    const domainScope = {} as DomainScope;
    const originalRuntime = createContainerContentsTestRuntime({
      apiClient,
      domainScope,
      execSql: originalDatabase.execSql,
    });
    const replacementRuntime = createContainerContentsTestRuntime({
      apiClient,
      domainScope,
      execSql: replacementDatabase.execSql,
    });
    const state = createContainerContentsStoreState(
      originalRuntime,
      defaultContainerContentsPersistence,
    );
    state.containersById.set(source.container.id, source);
    state.initialized = true;
    updateContainerContentsSnapshot(state);
    const hydrationRequests: Array<{
      followDiscoveredParentLanes?: boolean | undefined;
      parentIds?: ReadonlyArray<string | null> | undefined;
      resetAllLaneWatermarks?: boolean | undefined;
    }> = [];
    const syncAgent = {
      ensureInitialized: () => undefined,
      handleRemoteEvents: () => undefined,
      refreshLocalContainers: async () => undefined,
      requestRemoteHydration: async (options = {}) => {
        hydrationRequests.push(options);
        await defaultContainerContentsPersistence.deleteContainer(
          state.runtime.infra.execSql,
          source.container.id,
          { updatedAt: "2026-08-31T00:00:00.000Z" },
        );
      },
      scheduleSync: () => undefined,
    } as unknown as ContainerContentsStoreSyncAgent;
    const stillCurrent = captureContainerWriteGeneration(state);

    const deletion = deleteContainer(
      state,
      syncAgent,
      source.container.id,
      stillCurrent,
    );
    await deleteStarted;
    updateContainerContentsStoreRuntime(state, replacementRuntime, syncAgent);
    resolveDelete({
      data: {
        containerId: source.container.id,
        deletedAt: "2026-08-31T00:00:00.000Z",
      },
      ok: true,
    });

    await expect(deletion).resolves.toBeNull();
    expect(stillCurrent()).toBe(false);
    expect(hydrationRequests).toEqual([
      {
        followDiscoveredParentLanes: false,
        parentIds: [source.container.parentId],
        resetAllLaneWatermarks: true,
      },
    ]);
    expect(
      await defaultContainerContentsPersistence.containerExists(
        originalDatabase.execSql,
        source.container.id,
      ),
    ).toBe(false);
    expect(
      await defaultContainerContentsPersistence.containerExists(
        replacementDatabase.execSql,
        source.container.id,
      ),
    ).toBe(false);
  } finally {
    await originalDatabase.close();
    await replacementDatabase.close();
  }
});
