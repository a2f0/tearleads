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
import {
  ContainerSyncWatermarkRepository,
  containerParentSyncLane,
} from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { createDomainScope } from "../../../data/shared/domainScope";
import {
  disposeDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../../data/sync/syncCoordinator";
import { createContainerContentsStore } from "../containerContentsStore";

interface Connection {
  readonly generation?: number;
  readonly online: boolean;
  readonly peerScope?: string | null;
  readonly pendingAttempt?: number | undefined;
}

/**
 * A root-only store whose tree listings wait until the test answers them.
 * `connection.acknowledged` is what the runtime says about the interest
 * acknowledgement of the connection generation it carries.
 */
async function openStore(name: string) {
  const { execSql, close } = await createTestExecSql(name);
  const domainScope = createDomainScope();
  // Answers one tree listing request; `false` answers it as unavailable.
  const listings: Array<(available?: boolean) => void> = [];
  const answer = batchParentLanes(async () => ({
    ...emptyListContainersResponse(),
    nextWatermark: { id: "root-cursor", updatedAt: "2026-11-26T00:00:00Z" },
  }));
  const apiClient = createMockApiClient({
    // One entry per tree listing request, answered when the test says so.
    listContainerParentLanes: (...request: Parameters<typeof answer>) =>
      new Promise<Awaited<ReturnType<typeof answer>>>((resolve, reject) => {
        listings.push((available = true) =>
          available ? answer(...request).then(resolve, reject) : resolve(null),
        );
      }),
  });
  const connection = { acknowledged: false };
  const runtime = (next: Connection) => {
    const value = createContainerContentsTestRuntime({
      apiClient,
      domainScope,
      execSql,
      online: next.online,
      containerId: "root",
    });
    return {
      ...value,
      isAcknowledgementCurrent: () => connection.acknowledged,
      state: {
        ...value.state,
        peerScope: next.peerScope ?? null,
        serverEventsConnectionGeneration: next.generation ?? 1,
        serverEventsPendingConnectAttempt: next.pendingAttempt,
      },
    };
  };
  const listingCount = async (count: number, why: string) => {
    await waitFor(() => listings.length >= count, why);
    expect(listings).toHaveLength(count);
  };
  await seedLocalRootContainer(execSql, { rootContainerId: "root" });
  return {
    connection,
    dispose: () => {
      for (const release of listings) release();
      disposeDomainSyncCoordinator(domainScope);
      close();
    },
    domainScope,
    listingCount,
    listings,
    runtime,
    watermarks: new ContainerSyncWatermarkRepository(execSql),
  };
}

test("a crawl owed to a connection that dropped does not swallow the regained crawl", async () => {
  const harness = await openStore("stale-owed-crawl");
  const { listingCount, listings, runtime } = harness;
  try {
    // The store opens after a connection was acknowledged, so it owes that
    // connection's crawl. The socket has dropped since: the owed crawl cannot
    // start until a new acknowledgement arrives.
    const offline = runtime({ online: false });
    const store = createContainerContentsStore(offline);
    store.updateRuntime(offline);
    await waitFor(() => store.getSnapshot().ready, "Offline store not ready");

    // Back online with realtime still down: the regained crawl lists.
    store.updateRuntime(runtime({ online: true }));
    await listingCount(1, "The regained crawl did not list");

    // The crawl is superseded before its listing returns, and still no
    // acknowledgement has arrived. Nothing else will list the tree, so the
    // crawl is requested again in the new generation.
    store.updateRuntime(runtime({ online: true, peerScope: "peer-1" }));
    listings[0]?.();
    await listingCount(2, "The superseded crawl was dropped for a stale debt");
    listings[1]?.();
    await waitForDomainSyncCoordinatorToSettle(harness.domainScope);
  } finally {
    harness.dispose();
  }
});

/**
 * A store that regains its prerequisites while connect attempt 1 is pending,
 * so its regained crawl waits. The attempt is then acknowledged: the crawl
 * yields to the reconnect crawl, which sends the tree's one listing.
 */
async function yieldToAcknowledgedCrawl(name: string) {
  const harness = await openStore(name);
  const { connection, listingCount, runtime } = harness;
  const offline = runtime({ generation: 0, online: false });
  const store = createContainerContentsStore(offline);
  store.updateRuntime(offline);
  await waitFor(() => store.getSnapshot().ready, "Offline store not ready");
  store.updateRuntime(
    runtime({ generation: 0, online: true, pendingAttempt: 1 }),
  );
  // A held crawl counts as hydrating: the tree is listed when its wait ends,
  // by it or by the acknowledgement's crawl.
  await waitFor(() => store.getSnapshot().hydrating === true, "Not hydrating");
  expect(harness.listings).toHaveLength(0);
  connection.acknowledged = true;
  store.updateRuntime(runtime({ generation: 1, online: true }));
  await listingCount(1, "The reconnect crawl did not list");
  return { ...harness, store };
}

test("a crawl that yielded is restored when the acknowledgement is lost before its crawl lists", async () => {
  const harness = await yieldToAcknowledgedCrawl("yielded-crawl-restored");
  const { connection, listingCount, listings, watermarks } = harness;
  try {
    // The socket drops before the reconnect crawl's listing returns, so its
    // response is discarded and it cannot run again until a new
    // acknowledgement. The crawl that yielded to it lists in its place.
    connection.acknowledged = false;
    listings[0]?.();
    await listingCount(2, "The yielded crawl was not restored");
    listings[1]?.();
    await waitFor(
      async () =>
        (await watermarks.loadWatermark(containerParentSyncLane(null))) !==
        null,
      "The restored crawl did not save the root watermark",
    );
    // The reconnect crawl stays owed to its acknowledgement: nothing lists
    // the tree a third time.
    await Bun.sleep(1_500);
    expect(listings).toHaveLength(2);
  } finally {
    harness.dispose();
  }
});

test("a lost acknowledgement reported while the reconnect crawl lists waits for its answer", async () => {
  const harness = await yieldToAcknowledgedCrawl(
    "yielded-crawl-lost-in-flight",
  );
  const { connection, listingCount, listings, runtime, store } = harness;
  try {
    // Starting now would join a crawl whose answer is about to be discarded.
    connection.acknowledged = false;
    store.updateRuntime(runtime({ generation: 1, online: true }));
    await Bun.sleep(50);
    expect(listings).toHaveLength(1);
    listings[0]?.();
    await listingCount(2, "The yielded crawl was not restored");
  } finally {
    harness.dispose();
  }
});

test("a lost acknowledgement reported while the reconnect crawl backs off restores at once", async () => {
  const harness = await yieldToAcknowledgedCrawl("yielded-crawl-lost-backoff");
  const { connection, listingCount, listings, runtime, store } = harness;
  try {
    // The reconnect crawl's listing is unavailable, so it backs off; the
    // socket then drops, which the host reports with a runtime update.
    listings[0]?.(false);
    await Bun.sleep(50);
    expect(listings).toHaveLength(1);
    connection.acknowledged = false;
    store.updateRuntime(runtime({ generation: 1, online: true }));
    await listingCount(2, "The yielded crawl was not restored");
  } finally {
    harness.dispose();
  }
});

test("a crawl that yielded is not restored once the reconnect crawl lists", async () => {
  const harness = await yieldToAcknowledgedCrawl("yielded-crawl-covered");
  const { connection, listings, runtime, store, watermarks } = harness;
  try {
    listings[0]?.();
    await waitFor(
      async () =>
        (await watermarks.loadWatermark(containerParentSyncLane(null))) !==
        null,
      "The reconnect crawl did not save the root watermark",
    );
    // A later drop finds nothing owed: the tree was listed once.
    connection.acknowledged = false;
    store.updateRuntime(runtime({ generation: 1, online: true }));
    await Bun.sleep(50);
    expect(listings).toHaveLength(1);
    await waitFor(() => store.getSnapshot().hydrating === undefined, "Busy");
  } finally {
    harness.dispose();
  }
});
