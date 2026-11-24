import { expect, spyOn, test } from "bun:test";
import {
  createDomainScope,
  type DomainScope,
  type DomainSyncSnapshot,
  getOrCreateDomainSyncCoordinator,
  type SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { useRef } from "react";
import {
  hasActiveSyncWork,
  useDomainSyncActiveWork,
  useDomainSyncSnapshot,
} from "./useDomainSyncSnapshot";

test("a mounted sync panel observes the replacement coordinator's lanes", async () => {
  const scope = createDomainScope();
  const panel = renderHook(() => useDomainSyncSnapshot(scope));
  try {
    await act(async () => getOrCreateDomainSyncCoordinator(scope).dispose());
    await act(async () => {
      getOrCreateDomainSyncCoordinator(scope).registerLane("replacement", {
        run: async () => {},
      });
    });
    expect(
      panel.result.current.lanes.some((lane) => lane.key === "replacement"),
    ).toBe(true);
  } finally {
    panel.unmount();
    getOrCreateDomainSyncCoordinator(scope).dispose();
  }
});

function LaneCount({ scope }: { scope: DomainScope }) {
  return <output>{useDomainSyncSnapshot(scope).lanes.length}</output>;
}

// Registers a lane while rendering, as a provider that builds its SDK runtime
// in a render-time memo does.
function RegistersWhileRendering({ scope }: { scope: DomainScope }) {
  const registered = useRef(false);
  if (!registered.current) {
    registered.current = true;
    getOrCreateDomainSyncCoordinator(scope).registerLane("from-render", {
      run: async () => {},
    });
  }
  return null;
}

test("a lane published while another component renders reaches views after that render", async () => {
  const scope = createDomainScope();
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  try {
    const view = render(<LaneCount scope={scope} />);
    view.rerender(
      <>
        <LaneCount scope={scope} />
        <RegistersWhileRendering scope={scope} />
      </>,
    );
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("1"));
    const updatesDuringRender = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes("Cannot update a component"),
    );
    expect(updatesDuringRender).toEqual([]);
    view.unmount();
  } finally {
    consoleError.mockRestore();
    getOrCreateDomainSyncCoordinator(scope).dispose();
  }
});

function lane(overrides: Partial<SyncLaneSnapshot>): SyncLaneSnapshot {
  return {
    blobStorageKey: null,
    errorCount: 0,
    key: "container-contents",
    label: "Folders",
    lastAction: "requested",
    lastActionAt: "2026-11-24T00:00:00.000Z",
    lastCompletedAt: null,
    lastError: null,
    lastFailedAt: null,
    lastRequestedAt: "2026-11-24T00:00:00.000Z",
    lastStartedAt: null,
    phase: "structural",
    progress: null,
    registrationIndex: 0,
    requestCount: 1,
    requested: true,
    runAbandoned: false,
    runCount: 0,
    runDurations: null,
    running: false,
    status: "queued",
    ...overrides,
  };
}

function lanes(...entries: SyncLaneSnapshot[]): DomainSyncSnapshot {
  return {
    hasPendingWork: true,
    lanes: entries,
    pumpActive: true,
    updatedAt: "2026-11-24T00:00:00.000Z",
  };
}

test("healthy sync work is a lane requested or running that is not failing", () => {
  expect(hasActiveSyncWork(lanes(lane({})))).toBe(true);
  expect(
    hasActiveSyncWork(lanes(lane({ requested: false, running: true }))),
  ).toBe(true);
  expect(hasActiveSyncWork(lanes(lane({ requested: false })))).toBe(false);
  expect(hasActiveSyncWork(lanes())).toBe(false);
});

test("failing, abandoned, and upload lanes do not count as sync still working", () => {
  // A failing lane re-arms for the rest of the session.
  expect(hasActiveSyncWork(lanes(lane({ lastError: "Network error" })))).toBe(
    false,
  );
  expect(
    hasActiveSyncWork(lanes(lane({ running: true, runAbandoned: true }))),
  ).toBe(false);
  expect(hasActiveSyncWork(lanes(lane({ phase: "blob" })))).toBe(false);
  expect(
    hasActiveSyncWork(
      lanes(lane({ lastError: "Network error" }), lane({ key: "notes" })),
    ),
  ).toBe(true);
});

test("active sync work follows a lane's run and settles even while a failing lane retries", async () => {
  const scope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(scope);
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  coordinator.registerLane("pull", { run: () => released });
  // Re-requested on every pass, as a durable owner re-drives it, so it
  // fails and re-arms for as long as the session lasts.
  coordinator.registerLane("failing", {
    run: async () => {
      coordinator.requestLane("failing");
      throw new Error("Network error");
    },
  });
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  const view = renderHook(() => useDomainSyncActiveWork(scope));
  try {
    expect(view.result.current).toBe(false);
    await act(async () => coordinator.requestLane("failing"));
    await waitFor(() =>
      expect(
        coordinator
          .getSnapshot()
          .lanes.some((entry) => entry.lastError !== null && entry.requested),
      ).toBe(true),
    );
    expect(coordinator.getSnapshot().hasPendingWork).toBe(true);
    await waitFor(() => expect(view.result.current).toBe(false));

    await act(async () => coordinator.requestLane("pull"));
    await waitFor(() => expect(view.result.current).toBe(true));
    await act(async () => release());
    await waitFor(() => expect(view.result.current).toBe(false));
  } finally {
    view.unmount();
    coordinator.dispose();
    consoleError.mockRestore();
  }
});
