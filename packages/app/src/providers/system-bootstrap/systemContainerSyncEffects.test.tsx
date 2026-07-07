import { afterEach, expect, mock, test } from "bun:test";
import type { ContainerContentsStore } from "@tearleads/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import type { UserSystemContainer } from "../../stores/systemContainers";
import { useProvisionedSystemContainerPull } from "./systemContainerSyncEffects";

afterEach(cleanup);

// Must exceed the module-private 40-pull-per-sequence limit so the test actually
// drives more sequences than a single sequence's budget allows.
const SEQUENCES = 45;
const TRASH_SLOT = "provisioned-trash-slot";

function trashSystemContainer(): UserSystemContainer {
  return {
    icon: "trash",
    kind: "trash",
    name: "Trash",
    provisionedAtOrganizationCreation: true,
    systemSlot: TRASH_SLOT,
  };
}

// Regression: the provider that hosts this hook is not remounted across org
// switches or a logout/login, so the hook's attempt-budget ref outlives any one
// session. A new polling sequence must reset that budget; otherwise a prior
// sequence's spent attempts accumulate and, once the lifetime total crosses the
// per-sequence limit, permanently starve every later sequence's pull — the eager
// Trash would then never surface for a subsequent session.
test("provisioned-container pull is not starved across polling sequences", () => {
  const refreshRootLane = mock(() => Promise.resolve(true));
  // The provisioned slot never surfaces, so every sequence keeps pulling and the
  // per-sequence budget is what bounds it.
  const store = {
    getSnapshot: () => ({ nodes: [], ready: true }),
    refreshRootLane,
  } as unknown as ContainerContentsStore;

  const props = {
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

  // Each rerender hands the effect a fresh systemContainers reference, ending the
  // prior polling sequence (cleanup clears its interval) and starting a new one.
  // The pull that opens each sequence fires synchronously, so the interval never
  // has to tick for this to run past the limit.
  for (let sequence = 1; sequence < SEQUENCES; sequence += 1) {
    rerender({ ...props, systemContainers: [trashSystemContainer()] });
  }
  unmount();

  // Without the per-sequence reset the counter would cross the 40-pull limit and
  // pulling would stop; with it, all 45 sequences pull.
  expect(refreshRootLane.mock.calls.length).toBeGreaterThan(40);
  expect(refreshRootLane.mock.calls.length).toBe(SEQUENCES);
});

// Regression: a slow network must not let interval ticks pile up concurrent
// root-lane pulls and burn the attempt budget before the first request answers.
// With a pull that never settles the in-flight guard must keep every later tick
// from firing, so only the opening pull is ever issued.
test("provisioned-container pull does not fire concurrently while one is in flight", async () => {
  // Never settles: the in-flight guard is the only thing that can stop the
  // interval from issuing more pulls.
  const refreshRootLane = mock(() => new Promise<boolean>(() => {}));
  const store = {
    getSnapshot: () => ({ nodes: [], ready: true }),
    refreshRootLane,
  } as unknown as ContainerContentsStore;

  const { unmount } = renderHook(
    (hookProps: Parameters<typeof useProvisionedSystemContainerPull>[0]) =>
      useProvisionedSystemContainerPull(hookProps),
    {
      initialProps: {
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
