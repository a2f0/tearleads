import { expect, test } from "bun:test";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { waitFor } from "../../../../test/helpers/data/waitFor";
import {
  createContainerContentsTestRuntime,
  emptyListContainersResponse,
  seedLocalRootContainer,
} from "../../../../test/helpers/workflows/containerContentsTestRuntime";
import { createDomainScope } from "../../../data/shared/domainScope";
import {
  disposeDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../../data/sync/syncCoordinator";
import { createContainerContentsStore } from "../containerContentsStore";

test("a crawl owed to a connection that dropped does not swallow the regained crawl", async () => {
  const { execSql, close } = await createTestExecSql("stale-owed-crawl");
  const domainScope = createDomainScope();
  const listings: Array<() => void> = [];
  const answer = batchParentLanes(async () => emptyListContainersResponse());
  const apiClient = createMockApiClient({
    // One entry per tree listing request, answered when the test says so.
    listContainerParentLanes: (...request: Parameters<typeof answer>) =>
      new Promise<Awaited<ReturnType<typeof answer>>>((resolve, reject) => {
        listings.push(() => answer(...request).then(resolve, reject));
      }),
  });
  const connection = { acknowledged: false };
  const runtime = (online: boolean, peerScope: string | null = null) => {
    const value = createContainerContentsTestRuntime({
      apiClient,
      domainScope,
      execSql,
      online,
      containerId: "root",
    });
    return {
      ...value,
      isAcknowledgementCurrent: () => connection.acknowledged,
      state: {
        ...value.state,
        peerScope,
        serverEventsConnectionGeneration: 1,
      },
    };
  };
  const listingCount = async (count: number, why: string) => {
    await waitFor(() => listings.length >= count, why);
    expect(listings).toHaveLength(count);
  };
  try {
    await seedLocalRootContainer(execSql, { rootContainerId: "root" });
    // The store opens after a connection was acknowledged, so it owes that
    // connection's crawl. The socket has dropped since: the owed crawl cannot
    // start until a new acknowledgement arrives.
    const offline = runtime(false);
    const store = createContainerContentsStore(offline);
    store.updateRuntime(offline);
    await waitFor(() => store.getSnapshot().ready, "Offline store not ready");

    // Back online with realtime still down: the regained crawl lists.
    store.updateRuntime(runtime(true));
    await listingCount(1, "The regained crawl did not list");

    // The crawl is superseded before its listing returns, and still no
    // acknowledgement has arrived. Nothing else will list the tree, so the
    // crawl is requested again in the new generation.
    store.updateRuntime(runtime(true, "peer-1"));
    listings[0]?.();
    await listingCount(2, "The superseded crawl was dropped for a stale debt");
    listings[1]?.();
    await waitForDomainSyncCoordinatorToSettle(domainScope);
  } finally {
    for (const release of listings) release();
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});
