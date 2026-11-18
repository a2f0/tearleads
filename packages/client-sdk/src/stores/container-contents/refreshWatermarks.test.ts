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

test.each(["terminal", "continuation", "new API", "old API"])(
  "a %s page cannot rewind or switch the child lane ordering",
  async (ending) => {
    const { execSql, close } = await createTestExecSql("starting-cursor-cycle");
    const domainScope = createDomainScope();
    const cursor = (id: string) => ({
      id,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const middle = ending === "old API" ? "d1/b" : "b";
    const last =
      ending === "old API"
        ? "old-tail"
        : ending === "new API"
          ? "d1/tail"
          : "a";
    const reads: string[] = [];
    const apiClient = createMockApiClient({
      listContainerParentLanes: batchParentLanes(
        async ({ parentId, watermark }) => {
          if (parentId !== "root") return emptyListContainersResponse();
          reads.push(watermark?.id ?? "missing");
          return {
            ...emptyListContainersResponse(),
            hasMore: watermark?.id === "a" || ending === "continuation",
            nextWatermark: cursor(watermark?.id === "a" ? middle : last),
          };
        },
      ),
    });
    const base = createContainerContentsTestRuntime({
      apiClient,
      domainScope,
      execSql,
      containerId: "root",
    });
    const runtime = {
      ...base,
      state: { ...base.state, serverEventsConnectionGeneration: 1 },
    };
    try {
      await seedLocalRootContainer(execSql, { rootContainerId: "root" });
      const cursors = new ContainerSyncWatermarkRepository(execSql);
      await cursors.markChecked(createContainerParentSyncLane(null));
      const lane = createContainerParentSyncLane("root");
      await cursors.saveWatermark(lane, cursor("a"));
      const store = createContainerContentsStore(runtime);
      store.updateRuntime(runtime);
      await waitFor(
        () => reads.length >= 2,
        "child continuation did not start",
      );
      await waitForDomainSyncCoordinatorToSettle(domainScope);
      expect(reads).toEqual(["a", middle]);
      await waitFor(
        () => reads.length >= 4,
        "child continuation was not retried",
        2500,
      );
      expect(await cursors.loadWatermark(lane)).toEqual(cursor("a"));
      expect(reads).toEqual(["a", middle, "a", middle]);
    } finally {
      disposeDomainSyncCoordinator(domainScope);
      await close();
    }
  },
);

test("an unexpected reconnect failure reaches diagnostics and waits for a new connection", async () => {
  const { execSql, close } = await createTestExecSql("reconnect-diagnostics");
  const domainScope = createDomainScope();
  let attempts = 0;
  const failure = new Error("unexpected listing failure");
  const errors: unknown[] = [];
  const apiClient = createMockApiClient({
    listContainerParentLanes: async () => {
      attempts++;
      throw failure;
    },
  });
  const base = createContainerContentsTestRuntime({
    apiClient,
    domainScope,
    execSql,
    containerId: "root",
  });
  const runtime = {
    ...base,
    util: {
      ...base.util,
      logError: (_message: string | Error, error?: unknown) => {
        errors.push(error);
      },
    },
    state: { ...base.state, serverEventsConnectionGeneration: 1 },
  };
  try {
    await seedLocalRootContainer(execSql, { rootContainerId: "root" });
    const cursors = new ContainerSyncWatermarkRepository(execSql);
    await cursors.markChecked(createContainerParentSyncLane(null));
    await cursors.markChecked(createContainerParentSyncLane("root"));
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);
    await waitFor(() => attempts > 0, "reconnect never listed");
    await Bun.sleep(1_100);
    expect(errors).toContain(failure);
    expect(attempts).toBe(1);
    store.updateRuntime({
      ...runtime,
      state: { ...runtime.state, serverEventsConnectionGeneration: 2 },
    });
    await waitFor(() => attempts === 2, "a new acknowledgement did not retry");
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    await close();
  }
});
