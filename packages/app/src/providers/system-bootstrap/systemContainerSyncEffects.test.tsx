import { afterEach, expect, mock, test } from "bun:test";
import type {
  ContainerContentsStore,
  ContainerNode,
} from "@symcrypt/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import type { UserSystemContainer } from "../../stores/systemContainers";
import { useProvisionedSystemContainerPull } from "./systemContainerSyncEffects";

afterEach(cleanup);

// Must exceed the module-private 40-pull-per-sequence limit so the test actually
// drives more sequences than a single sequence's budget allows.
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

// Regression: the provider that hosts this hook is not remounted across org
// switches or a logout/login, so the hook's attempt-budget ref outlives any one
// session. A new polling sequence must reset that budget; otherwise a prior
// sequence's spent attempts accumulate and, once the lifetime total crosses the
// per-sequence limit, permanently starve every later sequence's pull — the eager
// Trash would then never surface for a subsequent session.
test("provisioned-container pull is not starved across polling sequences", async () => {
  const refreshRootLane = mock((_options?: RefreshRootLaneOptions) =>
    Promise.resolve(true),
  );
  // The provisioned slot never surfaces (locally or remotely), so every sequence
  // keeps pulling and the per-sequence budget is what bounds it.
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
    logError: () => {},
    snapshotReady: true,
    store,
    systemContainers: [trashSystemContainer()],
  };

  const { rerender, unmount } = renderHook(
    (hookProps: typeof props) => useProvisionedSystemContainerPull(hookProps),
    { initialProps: props },
  );

  // The opening pull of each sequence now fires only after the async local surface
  // resolves and finds the slot still missing, so flush the microtask chain between
  // sequences to let each sequence's fallback pull run before the next rerender's
  // cleanup cancels it. Each rerender hands the effect a fresh systemContainers
  // reference, ending the prior sequence (cleanup clears its interval) and starting
  // a new one; the 250ms interval never has to tick.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  for (let sequence = 1; sequence < SEQUENCES; sequence += 1) {
    rerender({ ...props, systemContainers: [trashSystemContainer()] });
    await flush();
  }
  unmount();

  // Without the per-sequence reset the counter would cross the 40-pull limit and
  // pulling would stop; with it, all 45 sequences pull.
  expect(refreshRootLane.mock.calls.length).toBeGreaterThan(40);
  expect(refreshRootLane.mock.calls.length).toBe(SEQUENCES);
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
        logError: () => {},
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
        logError: () => {},
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

test("provisioned-container pull accepts an opaque shared-org system slot", async () => {
  const nodes: ContainerNode[] = [
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
        logError: () => {},
        snapshotReady: true,
        store,
        systemContainers: [trashSystemContainer()],
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 320));
  unmount();

  expect(refreshRootLane).not.toHaveBeenCalled();
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
        logError: () => {},
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

// Regression: the in-flight ref persists across sequences (org switch / logout),
// so a cancelled sequence's late-resolving pull must NOT clear a fresh sequence's
// guard — otherwise the fresh sequence's next interval tick fires a concurrent pull
// and burns its budget. The pull's .finally is guarded by the per-sequence
// `cancelled` flag, so only the owning sequence clears its own guard.
test("a cancelled sequence's late pull does not reset a new sequence's in-flight guard", async () => {
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
    logError: () => {},
    snapshotReady: true,
    store,
    systemContainers: [trashSystemContainer()],
  };

  const { rerender, unmount } = renderHook(
    (hookProps: typeof props) => useProvisionedSystemContainerPull(hookProps),
    { initialProps: props },
  );

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  // Sequence A opens its pull (after the async local surface); it stays in flight.
  await flush();
  expect(refreshRootLane.mock.calls.length).toBe(1);

  // Cancel A and start sequence B; B opens its own pull while A's is still pending.
  rerender({ ...props, systemContainers: [trashSystemContainer()] });
  await flush();
  expect(refreshRootLane.mock.calls.length).toBe(2);

  // A's cancelled pull resolves. Its .finally must not clear B's in-flight guard.
  resolvers[0]?.(true);
  // Give B's 250ms interval a tick: with the guard intact, B's pull is still in
  // flight so the tick is skipped and no third pull fires. Without the guard, A's
  // .finally would have reset the ref and this tick would open a concurrent pull.
  await new Promise((resolve) => setTimeout(resolve, 320));
  unmount();

  expect(refreshRootLane.mock.calls.length).toBe(2);
});
