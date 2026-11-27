import { afterEach, expect, mock, test } from "bun:test";
import type {
  ContainerContentsStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { UserSystemContainer } from "../../stores/systemContainers";
import { useProvisionedSystemContainerPull } from "./systemContainerSyncEffects";

afterEach(cleanup);

// Far more effect runs than one organization's poll may ever pull for.
const SEQUENCES = 45;
const TRASH_SLOT = "provisioned-trash-slot";
type RefreshRootLaneOptions = Parameters<
  ContainerContentsStore["refreshRootLane"]
>[0];

function trashSystemContainer(): UserSystemContainer {
  return {
    icon: "trash",
    kind: "trash",
    name: "Trash",
    provisionedAtOrganizationCreation: true,
    systemSlot: TRASH_SLOT,
  };
}

function trashNode(): ContainerNode {
  return {
    icon: "trash",
    id: "trash-container",
    kind: "container",
    name: "Trash",
    organizationId: "org-1",
    parentId: "root-1",
    syncState: {
      lastError: null,
      pendingAttachmentBytes: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: 0,
      status: "synced",
    },
    systemSlot: TRASH_SLOT,
  };
}

function pullProps(store: ContainerContentsStore) {
  return {
    currentOrganizationId: "org-1",
    currentRootContainerId: "root-1",
    enabled: true,
    isAuthenticated: true,
    log: mock((_message: string) => {}),
    logError: () => {},
    online: true,
    snapshotReady: true,
    store,
    systemContainers: [trashSystemContainer()],
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Wait for the poll to give up, which it logs once. */
async function waitForLog(log: ReturnType<typeof mock>) {
  await waitFor(() => expect(log).toHaveBeenCalledTimes(1), {
    timeout: 5_000,
  });
}

// #3288: an account registered without a Trash (the CLI's `register` before
// it passed the app's provisioned containers) polled the root lane every
// 250 ms for ten seconds on every load, 40 parent-lane requests. The poll now
// stops after two listings and names the slot it could not find.
test("a provisioned-container poll that never finds its slot stops after two listings and logs the slot", async () => {
  const refreshRootLane = mock((_options?: RefreshRootLaneOptions) =>
    Promise.resolve(true),
  );
  const store = {
    getSnapshot: () => ({ nodes: [], ready: true }),
    refreshLocalContainers: () => Promise.resolve(),
    refreshRootLane,
  } as unknown as ContainerContentsStore;
  const props = pullProps(store);

  const { unmount } = renderHook(
    (hookProps: typeof props) => useProvisionedSystemContainerPull(hookProps),
    { initialProps: props },
  );
  await waitForLog(props.log);
  // Another tick would have sent a third listing by now, had the poll gone on.
  await new Promise((resolve) => setTimeout(resolve, 300));
  unmount();

  expect(refreshRootLane.mock.calls.length).toBe(2);
  expect(props.log.mock.calls).toEqual([
    [
      `System bootstrap: Trash (${TRASH_SLOT}) under root root-1 did not appear after 2 root-lane listing(s); stopped polling for it until the next load.`,
    ],
  ]);
});

// A pull the store could not list (offline, not initialized) sends no request,
// so it does not spend the listing budget; the tick budget still bounds it.
test("a provisioned-container pull that could not list does not spend the listing budget", async () => {
  let unlisted = 3;
  const refreshRootLane = mock((_options?: RefreshRootLaneOptions) => {
    unlisted -= 1;
    return Promise.resolve(unlisted < 0);
  });
  const store = {
    getSnapshot: () => ({ nodes: [], ready: true }),
    refreshLocalContainers: () => Promise.resolve(),
    refreshRootLane,
  } as unknown as ContainerContentsStore;
  const props = pullProps(store);

  const { unmount } = renderHook(
    (hookProps: typeof props) => useProvisionedSystemContainerPull(hookProps),
    { initialProps: props },
  );
  await waitForLog(props.log);
  await new Promise((resolve) => setTimeout(resolve, 300));
  unmount();

  expect(refreshRootLane.mock.calls.length).toBe(5);
  expect(props.log).toHaveBeenCalledTimes(1);
});

// The store defers a pull made while the live runtime is offline and resolves
// it as listed without sending anything, so the poll waits for the runtime
// instead of spending its listings there.
test("a provisioned-container poll waits while the live runtime is offline", async () => {
  const refreshRootLane = mock((_options?: RefreshRootLaneOptions) =>
    Promise.resolve(true),
  );
  const store = {
    getSnapshot: () => ({ nodes: [], ready: true }),
    refreshLocalContainers: () => Promise.resolve(),
    refreshRootLane,
  } as unknown as ContainerContentsStore;
  const props = { ...pullProps(store), online: false };

  const { rerender, unmount } = renderHook(
    (hookProps: typeof props) => useProvisionedSystemContainerPull(hookProps),
    { initialProps: props },
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(refreshRootLane).not.toHaveBeenCalled();

  rerender({ ...props, online: true });
  await waitForLog(props.log);
  unmount();
  expect(refreshRootLane.mock.calls.length).toBe(2);
});

// A store that replaces a superseded one is a new listing path, so it gets its
// own budget.
test("a provisioned-container poll starts a new budget for a new store", async () => {
  const createStore = () =>
    ({
      getSnapshot: () => ({ nodes: [], ready: true }),
      refreshLocalContainers: () => Promise.resolve(),
      refreshRootLane: mock((_options?: RefreshRootLaneOptions) =>
        Promise.resolve(true),
      ),
    }) as unknown as ContainerContentsStore;
  const first = createStore();
  const second = createStore();
  const props = pullProps(first);

  const { rerender, unmount } = renderHook(
    (hookProps: typeof props) => useProvisionedSystemContainerPull(hookProps),
    { initialProps: props },
  );
  await waitForLog(props.log);
  rerender({ ...props, store: second });
  await waitFor(() => expect(props.log).toHaveBeenCalledTimes(2), {
    timeout: 5_000,
  });
  unmount();
  expect(first.refreshRootLane).toHaveBeenCalledTimes(2);
  expect(second.refreshRootLane).toHaveBeenCalledTimes(2);
});

// The provider is not remounted across re-runs of the hook (a new
// systemContainers identity, the root id adopted after reconciliation, an org
// switch, a logout and login), so the budget is per organization for the
// whole load: re-running the hook does not start the poll over.
test("re-running the provisioned-container pull does not restart one organization's spent poll", async () => {
  const refreshRootLane = mock((_options?: RefreshRootLaneOptions) =>
    Promise.resolve(true),
  );
  const store = {
    getSnapshot: () => ({ nodes: [], ready: true }),
    refreshLocalContainers: () => Promise.resolve(),
    refreshRootLane,
  } as unknown as ContainerContentsStore;
  const props = pullProps(store);

  const { rerender, unmount } = renderHook(
    (hookProps: typeof props) => useProvisionedSystemContainerPull(hookProps),
    { initialProps: props },
  );
  // Each rerender hands the effect a fresh systemContainers reference, which
  // cleans up the running sequence and starts another.
  await flush();
  for (let sequence = 1; sequence < SEQUENCES; sequence += 1) {
    rerender({ ...props, systemContainers: [trashSystemContainer()] });
    await flush();
  }
  expect(refreshRootLane.mock.calls.length).toBe(2);
  expect(props.log).toHaveBeenCalledTimes(1);

  // Another organization's poll has its own budget: it is not starved.
  rerender({
    ...props,
    currentOrganizationId: "org-2",
    systemContainers: [trashSystemContainer()],
  });
  await flush();
  unmount();
  expect(refreshRootLane.mock.calls.length).toBe(3);
});

test("provisioned-container pull stops once the active root child lane hydrates the slot", async () => {
  let nodes: ContainerNode[] = [];
  const refreshRootLane = mock(async (_options?: RefreshRootLaneOptions) => {
    nodes = [trashNode()];
    return true;
  });
  // The local surface does not yield the slot here, so the remote fallback poll runs.
  const store = {
    getSnapshot: () => ({ nodes, ready: true }),
    refreshLocalContainers: () => Promise.resolve(),
    refreshRootLane,
  } as unknown as ContainerContentsStore;

  const { unmount } = renderHook(
    (hookProps: Parameters<typeof useProvisionedSystemContainerPull>[0]) =>
      useProvisionedSystemContainerPull(hookProps),
    {
      initialProps: {
        currentOrganizationId: "org-1",
        currentRootContainerId: "root-1",
        enabled: true,
        isAuthenticated: true,
        log: () => {},
        logError: () => {},
        online: true,
        snapshotReady: true,
        store,
        systemContainers: [trashSystemContainer()],
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 650));
  unmount();

  expect(refreshRootLane.mock.calls.length).toBe(1);
  expect(refreshRootLane.mock.calls[0]).toEqual([
    { includeActiveRootChildLane: true },
  ]);
});

// Option 1 (instant Trash surfacing): when the provisioned container is already in
// local SQLite (persistRegistrationBootstrap wrote it in the same flow), the local
// re-read surfaces it and the remote root-lane pull must never run — that is what
// makes the Trash appear instantly, with zero server round-trip, on both the
// personal (registration) and custom (createOrganization) org paths.
test("provisioned-container pull skips the remote poll when the local surface yields the slot", async () => {
  let nodes: ContainerNode[] = [];
  const refreshRootLane = mock((_options?: RefreshRootLaneOptions) =>
    Promise.resolve(true),
  );
  // The local surface fills the provisioned slot from SQLite.
  const refreshLocalContainers = mock(() => {
    nodes = [trashNode()];
    return Promise.resolve();
  });
  const store = {
    getSnapshot: () => ({ nodes, ready: true }),
    refreshLocalContainers,
    refreshRootLane,
  } as unknown as ContainerContentsStore;

  const { unmount } = renderHook(
    (hookProps: Parameters<typeof useProvisionedSystemContainerPull>[0]) =>
      useProvisionedSystemContainerPull(hookProps),
    {
      initialProps: {
        currentOrganizationId: "org-1",
        currentRootContainerId: "root-1",
        enabled: true,
        isAuthenticated: true,
        log: () => {},
        logError: () => {},
        online: true,
        snapshotReady: true,
        store,
        systemContainers: [trashSystemContainer()],
      },
    },
  );

  // Let the async local surface resolve and the fallback decision run; give the
  // 250ms interval room to have ticked, had one ever been started.
  await new Promise((resolve) => setTimeout(resolve, 650));
  unmount();

  expect(refreshLocalContainers.mock.calls.length).toBeGreaterThanOrEqual(1);
  // The slot surfaced locally, so no server round-trip is ever issued.
  expect(refreshRootLane.mock.calls.length).toBe(0);
});

test("provisioned-container pull continues until the shared organization slot appears despite a matching name", async () => {
  const nodes: ContainerNode[] = [
    {
      ...trashNode(),
      id: "foreign-metadata",
      name: "Organization Metadata",
      organizationId: "foreign-org",
      parentId: null,
      systemSlot: "opaque-org-metadata-slot",
    },
    {
      ...trashNode(),
      id: "foreign-root",
      name: "/",
      organizationId: "foreign-org",
      parentId: null,
      systemSlot: null,
    },
    {
      ...trashNode(),
      id: "foreign-trash",
      organizationId: "foreign-org",
      parentId: "foreign-root",
      systemSlot: "opaque-founder-trash-slot",
    },
  ];
  const refreshRootLane = mock((_options?: RefreshRootLaneOptions) =>
    Promise.resolve(true),
  );
  const store = {
    getSnapshot: () => ({ nodes, ready: true }),
    refreshLocalContainers: () => Promise.resolve(),
    refreshRootLane,
  } as unknown as ContainerContentsStore;

  const { unmount } = renderHook(
    (hookProps: Parameters<typeof useProvisionedSystemContainerPull>[0]) =>
      useProvisionedSystemContainerPull(hookProps),
    {
      initialProps: {
        currentOrganizationId: "foreign-org",
        currentRootContainerId: "viewer-home-root",
        enabled: true,
        isAuthenticated: true,
        log: () => {},
        logError: () => {},
        online: true,
        snapshotReady: true,
        store,
        systemContainers: [trashSystemContainer()],
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 320));
  unmount();

  expect(refreshRootLane).toHaveBeenCalled();
});

// Regression: a slow network must not let interval ticks pile up concurrent
// root-lane pulls and burn the attempt budget before the first request answers.
// With a pull that never settles the in-flight guard must keep every later tick
// from firing, so only the opening pull is ever issued.
test("provisioned-container pull does not fire concurrently while one is in flight", async () => {
  // Never settles: the in-flight guard is the only thing that can stop the
  // interval from issuing more pulls.
  const refreshRootLane = mock(
    (_options?: RefreshRootLaneOptions) => new Promise<boolean>(() => {}),
  );
  const store = {
    getSnapshot: () => ({ nodes: [], ready: true }),
    refreshLocalContainers: () => Promise.resolve(),
    refreshRootLane,
  } as unknown as ContainerContentsStore;

  const { unmount } = renderHook(
    (hookProps: Parameters<typeof useProvisionedSystemContainerPull>[0]) =>
      useProvisionedSystemContainerPull(hookProps),
    {
      initialProps: {
        currentOrganizationId: "org-1",
        currentRootContainerId: "root-1",
        enabled: true,
        isAuthenticated: true,
        log: () => {},
        logError: () => {},
        online: true,
        snapshotReady: true,
        store,
        systemContainers: [trashSystemContainer()],
      },
    },
  );

  // Let several 250ms interval ticks elapse while the opening pull is still
  // pending; each must be skipped by the in-flight guard.
  await new Promise((resolve) => setTimeout(resolve, 900));
  unmount();

  // Only the synchronous opening pull ran — no tick added a concurrent request.
  expect(refreshRootLane.mock.calls.length).toBe(1);
});

// Pulls stay sequential across sequences: a cleaned-up run's pull still in
// flight holds off the next run's, however many runs start meanwhile, so
// re-runs during one slow request cannot stack requests past the budget.
test("a cancelled sequence's pull in flight holds off the next sequence's pulls", async () => {
  const resolvers: Array<(value: boolean) => void> = [];
  const refreshRootLane = mock(
    (_options?: RefreshRootLaneOptions) =>
      new Promise<boolean>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  // The slot never surfaces (locally or remotely), so each sequence opens a pull.
  const store = {
    getSnapshot: () => ({ nodes: [], ready: true }),
    refreshLocalContainers: () => Promise.resolve(),
    refreshRootLane,
  } as unknown as ContainerContentsStore;

  const props = {
    currentOrganizationId: "org-1",
    currentRootContainerId: "root-1",
    enabled: true,
    isAuthenticated: true,
    log: () => {},
    logError: () => {},
    online: true,
    snapshotReady: true,
    store,
    systemContainers: [trashSystemContainer()],
  };

  const { rerender, unmount } = renderHook(
    (hookProps: typeof props) => useProvisionedSystemContainerPull(hookProps),
    { initialProps: props },
  );

  // Sequence A opens its pull (after the async local surface); it stays in flight.
  await flush();
  expect(refreshRootLane.mock.calls.length).toBe(1);

  // Cancel A and start more sequences while A's pull is still pending: none of
  // them opens a pull of its own. (Each run's opening tick counts against the
  // forty-tick bound, so stay well under it.)
  for (let sequence = 1; sequence < 10; sequence += 1) {
    rerender({ ...props, systemContainers: [trashSystemContainer()] });
    await flush();
  }
  await new Promise((resolve) => setTimeout(resolve, 320));
  expect(refreshRootLane.mock.calls.length).toBe(1);

  // A's pull resolves: the running sequence's next tick opens the second and
  // last listing, and its in-flight guard holds while that one is pending.
  resolvers[0]?.(true);
  await waitFor(() => expect(refreshRootLane.mock.calls.length).toBe(2), {
    timeout: 5_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 320));
  unmount();

  expect(refreshRootLane.mock.calls.length).toBe(2);
});
