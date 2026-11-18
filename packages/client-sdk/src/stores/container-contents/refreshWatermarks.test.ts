import { expect, test } from "bun:test";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/data/waitFor";
import {
  createContainerContentsTestRuntime,
  emptyListContainersResponse,
  seedLocalRootContainer,
} from "../../../test/helpers/workflows/containerContentsTestRuntime";
import { createDomainScope } from "../../data/shared/domainScope";
import {
  disposeDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
import {
  ContainerSyncWatermarkRepository,
  createContainerParentSyncLane,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";

test("reconnect preserves child watermarks while an explicit refresh resets them", async () => {
  const { execSql, close } = await createTestExecSql("refresh-watermarks");
  const domainScope = createDomainScope();
  const childWatermarks: unknown[] = [];
  const watermark = { id: "child", updatedAt: "2026-01-01T00:00:00.000Z" };
  const apiClient = createMockApiClient({
    listContainerParentLanes: batchParentLanes(
      async ({ parentId, watermark }) => {
        if (parentId === "root") childWatermarks.push(watermark ?? null);
        return emptyListContainersResponse();
      },
    ),
  });
  const runtime = (online: boolean) => {
    const value = createContainerContentsTestRuntime({
      apiClient,
      domainScope,
      execSql,
      online,
      containerId: "root",
    });
    return {
      ...value,
      state: {
        ...value.state,
        serverEventsConnectionGeneration: online ? 1 : 0,
      },
    };
  };
  try {
    await seedLocalRootContainer(execSql, { rootContainerId: "root" });
    const watermarks = new ContainerSyncWatermarkRepository(execSql);
    await watermarks.markChecked(createContainerParentSyncLane(null));
    await watermarks.saveWatermark(
      createContainerParentSyncLane("root"),
      watermark,
    );
    const offline = runtime(false);
    const store = createContainerContentsStore(offline);
    store.updateRuntime(offline);
    await waitFor(() => store.getSnapshot().ready, "Offline store not ready");
    store.updateRuntime(runtime(true));
    await waitFor(
      () => childWatermarks.length > 0,
      "Reconnect did not refresh child lane",
    );
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(
      childWatermarks.every(
        (value) => JSON.stringify(value) === JSON.stringify(watermark),
      ),
    ).toBe(true);
    childWatermarks.length = 0;
    await store.refresh();
    expect(childWatermarks).toContain(null);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});

test.each([false, true])(
  "a late-opened store recovers the acknowledged connection (first listing unavailable: %s)",
  async (failFirstListing) => {
    const { execSql, close } = await createTestExecSql(
      `refresh-watermarks-late-store-${crypto.randomUUID()}`,
    );
    const domainScope = createDomainScope();
    const listedLanes: (string | null)[] = [];
    const apiClient = createMockApiClient({
      listContainerParentLanes: batchParentLanes(async ({ parentId }) => {
        listedLanes.push(parentId ?? null);
        if (failFirstListing && listedLanes.length === 1) return null;
        return emptyListContainersResponse();
      }),
    });
    const base = createContainerContentsTestRuntime({
      apiClient,
      domainScope,
      execSql,
      online: true,
      containerId: "root",
    });
    // The socket's interest was acknowledged before this store existed.
    const runtime = {
      ...base,
      state: { ...base.state, serverEventsConnectionGeneration: 1 },
    };
    try {
      await seedLocalRootContainer(execSql, { rootContainerId: "root" });
      const watermarks = new ContainerSyncWatermarkRepository(execSql);
      await watermarks.markChecked(createContainerParentSyncLane(null));
      await watermarks.markChecked(createContainerParentSyncLane("root"));
      const store = createContainerContentsStore(runtime);
      store.updateRuntime(runtime);
      await waitFor(
        () =>
          listedLanes.filter((lane) => lane === null).length >=
            (failFirstListing ? 2 : 1) && listedLanes.includes("root"),
        "The reconnect crawl did not recover without another runtime update",
        2_500,
      );
      await waitForDomainSyncCoordinatorToSettle(domainScope);
    } finally {
      disposeDomainSyncCoordinator(domainScope);
      close();
    }
  },
);

test("a manual refresh queued behind reconnect still resets child watermarks", async () => {
  const { execSql, close } = await createTestExecSql("queued-reset-watermarks");
  const domainScope = createDomainScope();
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const childWatermarks: unknown[] = [];
  const apiClient = createMockApiClient({
    listContainerParentLanes: batchParentLanes(
      async ({ parentId, watermark }) => {
        if (parentId === "root") childWatermarks.push(watermark);
        started.resolve();
        await release.promise;
        return emptyListContainersResponse();
      },
    ),
  });
  const runtime = createContainerContentsTestRuntime({
    apiClient,
    domainScope,
    execSql,
    containerId: "root",
  });
  try {
    await seedLocalRootContainer(execSql, { rootContainerId: "root" });
    const watermarks = new ContainerSyncWatermarkRepository(execSql);
    await watermarks.markChecked(createContainerParentSyncLane(null));
    await watermarks.saveWatermark(createContainerParentSyncLane("root"), {
      id: "held",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);
    await waitFor(() => store.getSnapshot().ready, "store not ready");
    const active = store.refreshRootLane();
    await started.promise;
    store.updateRuntime({
      ...runtime,
      state: { ...runtime.state, serverEventsConnectionGeneration: 1 },
    });
    const manual = store.refresh();
    release.resolve();
    await Promise.all([active, manual]);
    expect(childWatermarks).toContain(null);
  } finally {
    release.resolve();
    disposeDomainSyncCoordinator(domainScope);
    await close();
  }
});
