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
  hasActiveStructuralSync,
  useDomainStructuralSyncActive,
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

const NOTE = {
  key: "documents:note",
  label: "Note",
  phase: "document",
} as const;

test("structural sync is working while a structural lane is requested or running", () => {
  expect(hasActiveStructuralSync(lanes(lane({})))).toBe(true);
  expect(
    hasActiveStructuralSync(lanes(lane({ requested: false, running: true }))),
  ).toBe(true);
  expect(hasActiveStructuralSync(lanes(lane({ requested: false })))).toBe(
    false,
  );
  expect(hasActiveStructuralSync(lanes())).toBe(false);
  // Document lanes bring content, not containers.
  expect(hasActiveStructuralSync(lanes(lane({ ...NOTE, running: true })))).toBe(
    false,
  );
});

test("a failing structural lane does not count, nor the lanes queued behind it", () => {
  // Backing off holds the phase barrier, so document lanes stay requested.
  const backingOff = lane({ lastError: "Network error", status: "queued" });
  expect(hasActiveStructuralSync(lanes(backingOff, lane(NOTE)))).toBe(false);
  // Its retry is not told apart from one that keeps failing, so it reads as
  // settled until a run completes.
  expect(
    hasActiveStructuralSync(
      lanes(lane({ lastError: "Network error", running: true })),
    ),
  ).toBe(false);
});

test("structural sync activity follows a lane's run and settles while a failing lane retries", async () => {
  const scope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(scope);
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  // Re-requested on every pass, as a durable owner re-drives it, so it
  // fails and re-arms for as long as the session lasts.
  coordinator.registerLane("failing", {
    phase: "structural",
    run: async () => {
      coordinator.requestLane("failing");
      throw new Error("Network error");
    },
  });
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  const view = renderHook(() => useDomainStructuralSyncActive(scope));
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

    coordinator.registerLane("pull", {
      phase: "structural",
      run: () => released,
    });
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
