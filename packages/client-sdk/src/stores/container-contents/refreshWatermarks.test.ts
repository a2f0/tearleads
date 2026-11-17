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

// The re-list after an acknowledged connection recovers hints lost while
// disconnected, so it does not trust a child-lane watermark: a folder written
// by an instance with a trailing clock can sort below one a sibling set.
test("reconnect and an explicit refresh both list child lanes from the start", async () => {
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
    expect(childWatermarks).toContain(null);
    expect(childWatermarks).not.toContainEqual(watermark);
    childWatermarks.length = 0;
    await store.refresh();
    expect(childWatermarks).toContain(null);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});

test("a reconnect re-list that waits behind other hydrations still lists child lanes from the start", async () => {
  const { execSql, close } = await createTestExecSql(
    `refresh-watermarks-coalesced-${crypto.randomUUID()}`,
  );
  const domainScope = createDomainScope();
  const childWatermarks: unknown[] = [];
  const watermark = { id: "child", updatedAt: "2026-01-01T00:00:00.000Z" };
  let releaseCrawl: () => void = () => undefined;
  const crawlReleased = new Promise<void>((resolve) => {
    releaseCrawl = resolve;
  });
  let crawlStarted = false;
  const apiClient = createMockApiClient({
    listContainerParentLanes: batchParentLanes(
      async ({ parentId, watermark }) => {
        if (!crawlStarted) {
          crawlStarted = true;
          await crawlReleased;
        }
        if (parentId === "root") childWatermarks.push(watermark ?? null);
        return emptyListContainersResponse();
      },
    ),
  });
  const runtime = (online: boolean, generation: number) => {
    const value = createContainerContentsTestRuntime({
      apiClient,
      domainScope,
      execSql,
      online,
      containerId: "root",
    });
    return {
      ...value,
      state: { ...value.state, serverEventsConnectionGeneration: generation },
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
    const offline = runtime(false, 0);
    const store = createContainerContentsStore(offline);
    store.updateRuntime(offline);
    await waitFor(() => store.getSnapshot().ready, "Offline store not ready");
    store.updateRuntime(runtime(true, 0));
    // A root-lane refresh holds the crawl while a second one, and then the
    // acknowledged connection's re-list, queue behind it.
    const active = store.refreshRootLane({ includeActiveRootChildLane: true });
    await waitFor(() => crawlStarted, "Root-lane refresh did not start");
    const queued = store.refreshRootLane({ includeActiveRootChildLane: true });
    store.updateRuntime(runtime(true, 1));
    childWatermarks.length = 0;
    releaseCrawl();
    await Promise.all([active, queued]);
    await waitFor(
      () => childWatermarks.includes(null),
      "The queued re-list kept the child-lane watermark",
    );
    await waitForDomainSyncCoordinatorToSettle(domainScope);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});
