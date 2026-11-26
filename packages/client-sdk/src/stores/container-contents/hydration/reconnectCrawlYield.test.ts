import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { withPrincipalPolicies } from "../../../../test/helpers/workflows/principalPolicyServiceFixture";
import { createDomainScope } from "../../../data/shared/domainScope";
import type { RemoteContainerHydrationHost } from "../../../workflows/container-contents/remoteHydration";
import { releaseSettledConnectAttemptWaits } from "./connectAttemptGate";
import {
  requestContainerContentsRemoteHydration,
  resumeContainerContentsRecoveryHydration,
} from "./remoteHydrationRequest";

type RequestState = Parameters<
  typeof requestContainerContentsRemoteHydration
>[0]["state"];
type ListParentLanes =
  RequestState["runtime"]["apiClient"]["listContainerParentLanes"];
type LaneResponse = Awaited<ReturnType<ListParentLanes>>;

const laneResponse: LaneResponse = {
  results: [
    {
      laneId: "lane-0",
      page: { hasMore: false, items: [], nextWatermark: null, tombstones: [] },
    },
  ],
};

let close: () => void = () => undefined;
let execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"];

beforeEach(async () => {
  const database = await createTestExecSql(`yield-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
});

afterEach(() => close());

/**
 * A store about to crawl after it regained its sync prerequisites. Each
 * listing request waits for `release`; `connection` is what the store's
 * runtime says about the server-events connection.
 */
function createRegainedStore(pendingConnectAttempt?: number) {
  const releases: Array<() => void> = [];
  const connection = { pendingConnectAttempt, reconnectCrawlOwed: false };
  const listContainerParentLanes: ListParentLanes = () =>
    new Promise<LaneResponse>((resolve) => {
      releases.push(() => resolve(laneResponse));
    });
  const state = {
    containerParentIdsNeedingHydration: new Set<string | null>(),
    containersById: new Map(),
    initializePromise: null,
    initialized: true,
    lifecycleGeneration: 0,
    localContainerRefreshGeneration: null,
    localContainerRefreshPromise: null,
    localContainerRefreshStructuralGeneration: null,
    localContainersNeedRefresh: false,
    persistence: { loadContainerHydrationTombstones: async () => [] },
    remoteHydrationPromise: null,
    remoteHydrationGeneration: null,
    remoteHydrationStructuralGeneration: null,
    rootLaneHydrated: false,
    runtime: withPrincipalPolicies({
      apiClient: { listContainerParentLanes },
      auth: { isAuthenticated: true },
      infra: { dbStatus: "ready", execSql },
      state: {
        domainScope: createDomainScope(),
        online: true,
        get serverEventsPendingConnectAttempt() {
          return connection.pendingConnectAttempt;
        },
      },
      util: { log: () => {} },
    }),
    snapshot: { ready: true },
    structuralGeneration: 0,
  } as unknown as RequestState;
  const host = {
    persistContainerState: async () => {
      throw new Error("an empty root lane persists no container");
    },
    updateSnapshot: () => {},
  } as RemoteContainerHydrationHost;
  const crawl = (yields: boolean) =>
    requestContainerContentsRemoteHydration({
      host,
      resumeRecoveryWork: async () => {
        await resumeContainerContentsRecoveryHydration(state);
      },
      scheduleSync: () => {},
      state,
      yieldsToReconnectCrawl: yields
        ? () => connection.reconnectCrawlOwed
        : undefined,
    });
  /** The acknowledgement: a new connection generation, with its crawl owed. */
  const acknowledge = () => {
    connection.pendingConnectAttempt = undefined;
    connection.reconnectCrawlOwed = true;
    state.structuralGeneration += 1;
    releaseSettledConnectAttemptWaits(state);
  };
  const settle = async () => {
    for (let turn = 0; turn < 20; turn += 1) await Bun.sleep(1);
  };
  return { acknowledge, connection, crawl, releases, settle, state };
}

test("a regained crawl superseded by an acknowledgement is not retried", async () => {
  const store = createRegainedStore();
  const hydration = store.crawl(true);
  await store.settle();
  expect(store.releases).toHaveLength(1);

  // The acknowledgement arrives while the listing is in flight.
  store.acknowledge();
  store.releases[0]?.();
  await hydration;
  await store.settle();

  // The reconnect crawl the acknowledgement owes lists the tree; this crawl
  // does not list it a second time.
  expect(store.releases).toHaveLength(1);
});

test.each([
  ["a crawl that does not yield", false, true],
  ["a yielding crawl with no reconnect crawl owed", true, false],
])("%s is retried in the new generation", async (_name, yields, owed) => {
  const store = createRegainedStore();
  const hydration = store.crawl(yields);
  await store.settle();

  store.acknowledge();
  store.connection.reconnectCrawlOwed = owed;
  store.releases[0]?.();
  await store.settle();
  expect(store.releases).toHaveLength(2);
  store.releases[1]?.();
  await hydration;
});

test("a regained crawl does not start while a connect attempt is pending", async () => {
  const store = createRegainedStore(7);
  const hydration = store.crawl(true);
  await store.settle();
  expect(store.releases).toHaveLength(0);

  // Acknowledged before it listed: the acknowledgement's crawl lists instead.
  store.acknowledge();
  await hydration;
  await store.settle();
  expect(store.releases).toHaveLength(0);
});

test("a regained crawl lists once its connect attempt ends unacknowledged", async () => {
  const store = createRegainedStore(7);
  const hydration = store.crawl(true);
  await store.settle();
  expect(store.releases).toHaveLength(0);

  store.connection.pendingConnectAttempt = undefined;
  releaseSettledConnectAttemptWaits(store.state);
  await store.settle();
  expect(store.releases).toHaveLength(1);
  store.releases[0]?.();
  await hydration;
});

test("only the regained crawl waits for a connect attempt", async () => {
  const store = createRegainedStore(7);
  const hydration = store.crawl(false);
  await store.settle();
  expect(store.releases).toHaveLength(1);
  store.releases[0]?.();
  await hydration;
});

test("a held crawl holds no other request back", async () => {
  const store = createRegainedStore(7);
  const held = store.crawl(true);
  await store.settle();
  expect(store.state.remoteHydrationPromise).toBeNull();

  // A refresh, or a write's follow-up crawl, made while the connection is
  // still being made lists at once.
  const refresh = store.crawl(false);
  await store.settle();
  expect(store.releases).toHaveLength(1);
  store.releases[0]?.();
  await refresh;

  // The attempt ends unacknowledged: the held crawl now lists too.
  store.connection.pendingConnectAttempt = undefined;
  releaseSettledConnectAttemptWaits(store.state);
  await store.settle();
  expect(store.releases).toHaveLength(2);
  store.releases[1]?.();
  await held;
});

test("a held crawl superseded without an acknowledgement lists in the new generation", async () => {
  const store = createRegainedStore(7);
  const held = store.crawl(true);
  await store.settle();

  // The store's runtime is replaced while the socket is still unavailable,
  // and then the attempt ends: no acknowledged crawl is owed.
  store.state.structuralGeneration += 1;
  store.connection.pendingConnectAttempt = undefined;
  releaseSettledConnectAttemptWaits(store.state);
  await store.settle();
  expect(store.releases).toHaveLength(1);
  store.releases[0]?.();
  await held;
});

test("a held crawl superseded while a new attempt is pending waits for it", async () => {
  const store = createRegainedStore(7);
  const held = store.crawl(true);
  await store.settle();

  // The network flaps during the connect: the store's generation moves and
  // a new attempt replaces the one the crawl waited on.
  store.state.structuralGeneration += 1;
  store.connection.pendingConnectAttempt = 8;
  releaseSettledConnectAttemptWaits(store.state);
  await store.settle();
  expect(store.releases).toHaveLength(0);

  store.acknowledge();
  await held;
  expect(store.releases).toHaveLength(0);
});
