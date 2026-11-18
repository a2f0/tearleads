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

test("a store opened after the connection was acknowledged still re-lists its lanes", async () => {
  const { execSql, close } = await createTestExecSql(
    `refresh-watermarks-late-store-${crypto.randomUUID()}`,
  );
  const domainScope = createDomainScope();
  const listedLanes: (string | null)[] = [];
  const apiClient = createMockApiClient({
    listContainerParentLanes: batchParentLanes(async ({ parentId }) => {
      listedLanes.push(parentId ?? null);
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
      () => listedLanes.includes("root"),
      "A late-opened store never re-listed its lanes",
    );
    await waitForDomainSyncCoordinatorToSettle(domainScope);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});
