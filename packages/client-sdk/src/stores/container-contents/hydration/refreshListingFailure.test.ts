import { expect, test } from "bun:test";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import type { ListContainerParentLanesResponse } from "@tearleads/validators/response";
import { waitFor } from "../../../../test/helpers/data/waitFor";
import {
  createContainerContentsTestRuntime,
  emptyListContainersResponse,
  seedLocalRootContainer,
} from "../../../../test/helpers/workflows/containerContentsTestRuntime";
import type { DomainScope } from "../../../data/shared/domainScope";
import {
  ContainerSyncWatermarkRepository,
  createContainerParentSyncLane,
} from "../../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "../containerContentsStore";
import type { ContainerContentsStore } from "../types";

type ParentLaneLister = (
  input: ListContainerParentLanesRequest,
) => Promise<ListContainerParentLanesResponse | null>;

/** A warm-cache store whose parent-lane listings `listParentLanes` answers. */
async function readyStore(
  name: string,
  listParentLanes: ParentLaneLister,
): Promise<{ close: () => void; store: ContainerContentsStore }> {
  const { close, execSql } = await createTestExecSql(name);
  // A checked root lane keeps startup cache-first: no listing until refresh.
  await seedLocalRootContainer(execSql, { rootContainerId: "peer-root" });
  await new ContainerSyncWatermarkRepository(execSql).markChecked(
    createContainerParentSyncLane(null),
  );
  const runtime = createContainerContentsTestRuntime({
    apiClient: createMockApiClient({
      listContainerParentLanes: listParentLanes,
    }),
    domainScope: {} as DomainScope,
    execSql,
  });
  const store = createContainerContentsStore(runtime);
  store.updateRuntime(runtime);
  await waitFor(
    () => store.getSnapshot().ready,
    "Container contents store did not become ready.",
  );
  return { close, store };
}

const listEmptyLanes = batchParentLanes(async () =>
  emptyListContainersResponse(),
);

// A crawl whose listing request fails stops short while its promise still
// settles. An explicit refresh learns of it so its caller can report a stale
// tree; a crawl whose listings all answer reports nothing.
test("refresh reports a container listing that failed", async () => {
  let listingAvailable = true;
  const { close, store } = await readyStore(
    "container-contents-store-refresh-listing-unavailable-test",
    async (input) => (listingAvailable ? listEmptyLanes(input) : null),
  );
  try {
    let unavailable = 0;
    const onListingUnavailable = () => {
      unavailable += 1;
    };
    await store.refresh({ onListingUnavailable });
    expect(unavailable).toBe(0);

    listingAvailable = false;
    await store.refresh({ onListingUnavailable });
    expect(unavailable).toBe(1);
  } finally {
    close();
  }
});

// Two refreshes queued behind a running crawl share the one follow-up crawl
// that takes over their parent lanes. Both must settle with it and learn of
// its listing failure, not only the one whose request started it.
test("refreshes queued behind a crawl both learn of its listing failure", async () => {
  const releaseFirstCrawl = Promise.withResolvers<void>();
  const firstCrawlStarted = Promise.withResolvers<void>();
  let listings = 0;
  const { close, store } = await readyStore(
    "container-contents-store-queued-refresh-listing-unavailable-test",
    async (input) => {
      listings += 1;
      if (listings > 1) return null;
      firstCrawlStarted.resolve();
      await releaseFirstCrawl.promise;
      return listEmptyLanes(input);
    },
  );
  try {
    const running = store.refresh();
    await firstCrawlStarted.promise;
    const unavailable = { first: 0, second: 0 };
    const first = store.refresh({
      onListingUnavailable: () => {
        unavailable.first += 1;
      },
    });
    const second = store.refresh({
      onListingUnavailable: () => {
        unavailable.second += 1;
      },
    });
    releaseFirstCrawl.resolve();

    await Promise.all([running, first, second]);
    expect(unavailable).toEqual({ first: 1, second: 1 });
  } finally {
    close();
  }
});

test("crawlTreeForCatchUp runs its own pass after an active crawl and returns true", async () => {
  const releaseFirstCrawl = Promise.withResolvers<void>();
  const firstCrawlStarted = Promise.withResolvers<void>();
  let calls = 0;
  const { close, store } = await readyStore(
    "container-contents-store-catchup-crawl-concurrency-test",
    async (input) => {
      calls += 1;
      if (calls === 1) {
        firstCrawlStarted.resolve();
        await releaseFirstCrawl.promise;
      }
      return listEmptyLanes(input);
    },
  );
  try {
    const running = store.refresh();
    await firstCrawlStarted.promise;
    const catchUp = store.crawlTreeForCatchUp();
    releaseFirstCrawl.resolve();
    const [, completed] = await Promise.all([running, catchUp]);
    expect(completed).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
  } finally {
    close();
  }
});

test("crawlTreeForCatchUp returns false on listing failure and retains no recovery crawl while offline", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-catchup-crawl-offline-test",
  );
  let calls = 0;
  let available = false;
  try {
    await seedLocalRootContainer(execSql, { rootContainerId: "peer-root" });
    await new ContainerSyncWatermarkRepository(execSql).markChecked(
      createContainerParentSyncLane(null),
    );
    const makeRuntime = (online: boolean) =>
      createContainerContentsTestRuntime({
        apiClient: createMockApiClient({
          listContainerParentLanes: async (input) => {
            calls += 1;
            return available ? listEmptyLanes(input) : null;
          },
        }),
        domainScope: {} as DomainScope,
        execSql,
        online,
      });
    const domainScope = {} as DomainScope;
    const runtime = (online: boolean) => ({
      ...makeRuntime(online),
      state: { ...makeRuntime(online).state, domainScope },
    });
    const store = createContainerContentsStore(runtime(true));
    store.updateRuntime(runtime(true));
    await waitFor(() => store.getSnapshot().ready, "Store did not hydrate");

    // Failed listing returns false so catch-up falls back to all known lanes.
    expect(await store.crawlTreeForCatchUp()).toBe(false);
    const callsAfterFailure = calls;

    // Offline catch-up returns false without scheduling a retained recovery crawl.
    store.updateRuntime(runtime(false));
    expect(await store.crawlTreeForCatchUp()).toBe(false);
    expect(calls).toBe(callsAfterFailure);

    available = true;
    store.updateRuntime(runtime(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await store.crawlTreeForCatchUp()).toBe(true);
  } finally {
    close();
  }
});
