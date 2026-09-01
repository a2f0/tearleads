import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DomainScope } from "../../data/domainScope";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { deleteContainer } from "./operations";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

test("remote deletion cannot erase a same-id replacement persisted while awaiting", async () => {
  const database = await createTestExecSql("container-delete-replacement-race");
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
  const replacement = {
    ...source,
    container: {
      ...source.container,
      metadataDocumentId: "metadata-replacement",
      parentId: "replacement-parent",
    },
    record: {
      ...source.record,
      accessStateHash: "access-replacement",
      documentId: "metadata-replacement",
    },
  };

  try {
    await defaultContainerContentsPersistence.ensureSchema(database.execSql);
    await defaultContainerContentsPersistence.saveContainer(
      database.execSql,
      source.container,
      source.record,
    );
    const state = createContainerContentsStoreState(
      createContainerContentsTestRuntime({
        apiClient,
        domainScope: {} as DomainScope,
        execSql: database.execSql,
      }),
      defaultContainerContentsPersistence,
    );
    state.containersById.set(source.container.id, source);
    state.initialized = true;
    updateContainerContentsSnapshot(state);
    let hydrationRequests = 0;
    let refreshes = 0;
    const syncAgent = {
      refreshLocalContainers: async () => {
        refreshes += 1;
      },
      requestRemoteHydration: async () => {
        hydrationRequests += 1;
      },
    } as unknown as ContainerContentsStoreSyncAgent;

    const deletion = deleteContainer(state, syncAgent, source.container.id);
    await deleteStarted;
    await defaultContainerContentsPersistence.saveContainer(
      database.execSql,
      replacement.container,
      replacement.record,
    );
    state.containersById.set(replacement.container.id, replacement);
    resolveDelete({
      data: {
        containerId: source.container.id,
        deletedAt: "2026-09-01T00:00:00.000Z",
      },
      ok: true,
    });

    await expect(deletion).resolves.toBeNull();
    expect(state.containersById.get(source.container.id)).toBe(replacement);
    expect(refreshes).toBe(1);
    expect(hydrationRequests).toBe(1);
    expect(
      await defaultContainerContentsPersistence.containerExists(
        database.execSql,
        source.container.id,
      ),
    ).toBe(true);
    expect(
      (
        await defaultContainerContentsPersistence.loadContainers(
          database.execSql,
        )
      )[0]?.container,
    ).toMatchObject({
      metadataDocumentId: replacement.container.metadataDocumentId,
      parentId: replacement.container.parentId,
    });
  } finally {
    await database.close();
  }
});
