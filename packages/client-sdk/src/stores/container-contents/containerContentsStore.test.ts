import { expect, test } from "bun:test";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type {
  ListContainersResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import { waitFor } from "../../../test/helpers/waitFor";
import type { DomainScope } from "../../data/domainScope";
import {
  type ContainerContentsPersistence,
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
  loadContainerSyncLaneCheckRecords,
  markContainerSyncLaneChecked,
  saveContainerSyncWatermark,
} from "../../workflows/container-contents/containerPersistence";
import {
  createContainerContentsStore,
  getOrCreateContainerContentsStore,
} from "./containerContentsStore";
import {
  createContainerContentsTestRuntime,
  emptyListContainersResponse,
  seedLocalRootContainer,
} from "./runtime.testFixtures";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolveValue: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });

  return {
    promise,
    resolve: (value) => {
      if (!resolveValue) {
        throw new Error("Deferred promise was not initialized.");
      }

      resolveValue(value);
    },
  };
}

test("getOrCreateContainerContentsStore applies updated options to the cached scope store", async () => {
  const domainScope = {} as DomainScope;
  const logs: string[] = [];
  let ensureSchemaCalls = 0;
  let loadContainersCalls = 0;
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    ensureSchema: async () => {
      ensureSchemaCalls += 1;
    },
    loadContainers: async () => {
      loadContainersCalls += 1;
      return [];
    },
  };
  const runtime = createContainerContentsTestRuntime({
    domainScope,
    execSql: async () => {
      throw new Error("Unexpected SQL call in container contents store test.");
    },
    isAuthenticated: false,
    log: (message) => logs.push(message),
    online: false,
  });

  const store = getOrCreateContainerContentsStore(domainScope, runtime, {
    logLabel: "Initial label",
  });
  const sameStore = getOrCreateContainerContentsStore(domainScope, runtime, {
    logLabel: "Updated label",
    persistence,
  });

  expect(sameStore).toBe(store);

  const initialized = new Promise<void>((resolve) => {
    const unsubscribe = sameStore.subscribe(() => {
      if (sameStore.getSnapshot().ready) {
        unsubscribe();
        resolve();
      }
    });
  });
  sameStore.updateRuntime(runtime);
  await initialized;

  expect(ensureSchemaCalls).toBe(1);
  expect(loadContainersCalls).toBe(1);
  expect(logs).toContain("Updated label: loaded 0 container(s)");
});

test("incomplete container persistence adapters refuse queued child creation", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-legacy-persistence",
  );
  const domainScope = {} as DomainScope;
  try {
    await seedLocalRootContainer(execSql, { rootContainerId: "legacy-root" });
    const persistence: ContainerContentsPersistence = {
      ...defaultContainerContentsPersistence,
    };
    Reflect.deleteProperty(persistence, "saveContainerWithPendingUpdate");
    const runtime = createContainerContentsTestRuntime({
      domainScope,
      execSql,
      online: false,
    });
    const store = createContainerContentsStore(runtime, persistence);
    store.updateRuntime(runtime);
    await waitFor(
      () => store.getSnapshot().ready,
      "Legacy persistence store did not become ready.",
    );

    const child = await store.createChild("legacy-root", "Legacy child");

    expect(child).toBeNull();
    await expect(persistence.loadContainers(execSql)).resolves.toHaveLength(1);
  } finally {
    close();
  }
});

test("container contents store publishes cached containers before startup hydration completes", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-cache-first-startup-test",
  );
  const domainScope = {} as DomainScope;
  const listedContainers = createDeferred<ListContainersResponse>();
  let parentLaneResolversStarted = 0;
  let parentLaneResolversSettled = 0;

  try {
    await seedLocalRootContainer(execSql, { rootContainerId: "cached-root" });
    await markContainerSyncLaneChecked(
      execSql,
      createContainerParentSyncLane(null),
    );
    await execSql(
      "UPDATE container_sync_lane_checks SET checked_at = ? WHERE lane_kind = ? AND lane_id = ?",
      ["2026-01-01T00:00:00.000Z", "container_parent", "root"],
    );

    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: batchParentLanes(async () => {
          parentLaneResolversStarted += 1;
          const response = await listedContainers.promise;
          parentLaneResolversSettled += 1;
          return response;
        }),
      }),
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      "cached-root",
    );
    expect(parentLaneResolversSettled).toBe(0);

    if (parentLaneResolversStarted === 0) {
      await waitFor(
        () => parentLaneResolversStarted > 0,
        "Startup hydration was not scheduled.",
      );
    }
    listedContainers.resolve(emptyListContainersResponse());
    await waitFor(
      () =>
        parentLaneResolversStarted > 0 &&
        parentLaneResolversSettled === parentLaneResolversStarted,
      "Startup hydration did not settle.",
    );
    await waitFor(async () => {
      const checks = await loadContainerSyncLaneCheckRecords(execSql, [
        createContainerParentSyncLane(null),
      ]);
      return checks.every((check) => check !== null);
    }, "Startup hydration did not save lane check markers.");
  } finally {
    close();
  }
});

function sharedRootSummary(): ListContainersResponse {
  return {
    hasMore: false,
    items: [
      {
        createdAt: "2026-06-19T00:00:00.000Z",
        depth: 0,
        effectiveAccessLevel: "admin",
        id: "owner-root",
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "owner-root-access-hash",
        metadataDocumentId: "owner-root-metadata-document",
        metadataReferencedPrincipals: [],
        organizationId: "org-2",
        parentId: null,
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ],
    nextWatermark: {
      id: "owner-root",
      updatedAt: "2026-06-19T00:00:00.000Z",
    },
    tombstones: [],
  };
}

function sharedRootChildSummary(): ListContainersResponse {
  return {
    hasMore: false,
    items: [
      {
        createdAt: "2026-06-19T00:00:00.000Z",
        depth: 1,
        effectiveAccessLevel: "admin",
        id: "owner-child",
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "owner-child-access-hash",
        metadataDocumentId: "owner-child-metadata-document",
        metadataReferencedPrincipals: [],
        organizationId: "org-2",
        parentId: "owner-root",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ],
    nextWatermark: {
      id: "owner-child",
      updatedAt: "2026-06-19T00:00:00.000Z",
    },
    tombstones: [],
  };
}

test("root-lane refresh follows a newly discovered shared root into its children", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-root-lane-hydrates-shared-children-test",
  );
  const domainScope = {} as DomainScope;

  try {
    // Warm cache: the peer already has their own root locally with a freshly
    // checked, watermarked root lane — the same cache-first startup posture as the
    // sibling test above.
    await seedLocalRootContainer(execSql, { rootContainerId: "peer-root" });
    await markContainerSyncLaneChecked(
      execSql,
      createContainerParentSyncLane(null),
    );
    await saveContainerSyncWatermark(
      execSql,
      createContainerParentSyncLane(null),
      { id: "peer-root", updatedAt: "2026-06-20T00:00:00.000Z" },
    );

    const childLaneParentIds: Array<string | null | undefined> = [];
    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: batchParentLanes(
          async ({ parentId, watermark }) => {
            if (parentId === "owner-root") {
              childLaneParentIds.push(parentId);
              return watermark
                ? emptyListContainersResponse()
                : sharedRootChildSummary();
            }
            if (parentId !== null && parentId !== undefined) {
              return emptyListContainersResponse();
            }
            return watermark
              ? emptyListContainersResponse()
              : sharedRootSummary();
          },
        ),
      }),
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    // refreshRootLane is the AUTOMATIC path (shared_with_you websocket event,
    // startup catch-up): followDiscoveredParentLanes is false, so before the fix it
    // surfaced owner-root but never listed its children. It must now recurse into a
    // freshly discovered root so its already-remote children appear without a
    // manual View -> Refresh.
    await store.refreshRootLane();

    await waitFor(
      () => store.getSnapshot().nodes.some((node) => node.id === "owner-child"),
      "Root-lane refresh did not hydrate the shared root's children.",
    );
    expect(childLaneParentIds).toContain("owner-root");
  } finally {
    close();
  }
});

test("refresh re-lists the root lane unwatermarked to surface a newly shared root", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-refresh-discovers-shared-root-test",
  );
  const domainScope = {} as DomainScope;
  const rootLaneWatermarks: Array<SyncWatermark | null | undefined> = [];

  try {
    // Warm cache: the peer already has their own root container locally, the
    // root lane is marked freshly checked, and it carries a persisted watermark
    // from a prior sync. Startup stays cache-first and does not auto-probe.
    await seedLocalRootContainer(execSql, { rootContainerId: "peer-root" });
    await markContainerSyncLaneChecked(
      execSql,
      createContainerParentSyncLane(null),
    );
    // The shared root's updatedAt predates this watermark (joining a group does
    // not bump it), so a watermarked resume would filter it out forever.
    await saveContainerSyncWatermark(
      execSql,
      createContainerParentSyncLane(null),
      { id: "peer-root", updatedAt: "2026-06-20T00:00:00.000Z" },
    );

    // The server grants the peer access to the owner's root container, but only
    // returns it when the root lane is probed WITHOUT the stale watermark.
    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: batchParentLanes(
          async ({ parentId, watermark }) => {
            if (parentId !== null && parentId !== undefined) {
              return emptyListContainersResponse();
            }
            rootLaneWatermarks.push(watermark);
            return watermark
              ? emptyListContainersResponse()
              : sharedRootSummary();
          },
        ),
      }),
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    // Cache-first: only the peer's own root is visible before refresh.
    expect(store.getSnapshot().nodes.map((node) => node.id)).toEqual([
      "peer-root",
    ]);

    // The refresh button (reconcileNow -> refreshTree -> store.refresh()) probes
    // the root lane WITHOUT the persisted watermark and discovers the share.
    await store.refresh();

    await waitFor(
      () => store.getSnapshot().nodes.some((node) => node.id === "owner-root"),
      "Refresh did not surface the newly shared root container.",
    );
    expect(rootLaneWatermarks).toContainEqual(null);
  } finally {
    close();
  }
});
