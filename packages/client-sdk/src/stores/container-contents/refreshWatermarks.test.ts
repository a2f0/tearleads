import { expect, test } from "bun:test";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../../data/domainScope";
import {
  disposeDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
import {
  createContainerParentSyncLane,
  markContainerSyncLaneChecked,
  saveContainerSyncWatermark,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";
import {
  createContainerContentsTestRuntime,
  emptyListContainersResponse,
  seedLocalRootContainer,
} from "./runtime.testFixtures";

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
    await markContainerSyncLaneChecked(
      execSql,
      createContainerParentSyncLane(null),
    );
    await saveContainerSyncWatermark(
      execSql,
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
