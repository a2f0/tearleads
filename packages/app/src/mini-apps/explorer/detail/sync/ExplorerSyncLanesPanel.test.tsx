import { afterEach, expect, test } from "bun:test";
import type {
  DomainScope,
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import {
  createDomainScope,
  getOrCreateDomainSyncCoordinator,
  requestAllDomainSyncLanes,
  waitForDomainSyncCoordinatorToSettle,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../../../components/window/WindowMenuContext";
import { EXPLORER_LABELS } from "../../labels";
import {
  ExplorerSyncLanesPanel,
  ExplorerSyncLanesPanelView,
  getExplorerSyncLaneProgress,
} from "./ExplorerSyncLanesPanel";

let restorePhoneMatchMedia: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restorePhoneMatchMedia?.();
  restorePhoneMatchMedia = null;
  globalThis.localStorage.clear();
});

const updatedAt = "2026-06-15T12:00:00.000Z";

function createLaneSnapshot(
  overrides: Partial<SyncLaneSnapshot>,
): SyncLaneSnapshot {
  return {
    errorCount: 0,
    key: "container-contents",
    label: "Container contents",
    lastAction: "registered",
    lastActionAt: updatedAt,
    lastCompletedAt: null,
    lastError: null,
    lastFailedAt: null,
    lastRequestedAt: null,
    lastStartedAt: null,
    phase: "structural",
    progress: null,
    registrationIndex: 0,
    requestCount: 0,
    requested: false,
    runCount: 0,
    running: false,
    status: "idle",
    ...overrides,
  };
}

function createSnapshot(
  lanes: ReadonlyArray<SyncLaneSnapshot>,
): DomainSyncSnapshot {
  return {
    hasPendingWork: lanes.some((lane) => lane.requested || lane.running),
    lanes,
    pumpActive: lanes.some((lane) => lane.running),
    updatedAt,
  };
}

function renderSyncLanesPanel(input: {
  onOpenLaneDetail?: ((laneKey: string) => void) | undefined;
  selectedLaneKey?: string | null | undefined;
  snapshot: DomainSyncSnapshot;
}) {
  return render(
    createElement(ExplorerSyncLanesPanelView, {
      onBackToSelectionRoute: () => undefined,
      onBackToSyncLanesRoute: () => undefined,
      onOpenLaneDetail: input.onOpenLaneDetail ?? (() => undefined),
      selectedLaneKey: input.selectedLaneKey ?? null,
      snapshot: input.snapshot,
    }),
  );
}

// The manual "Sync now" trigger now lives on the window toolbar, registered by
// the container. This probe surfaces the registered title-bar actions as
// buttons so tests can assert on the toolbar the same way the chrome does.
function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={action.label}
          disabled={action.disabled}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

function renderSyncLanesPanelContainer(input: {
  domainScope: DomainScope;
  selectedLaneKey?: string | null | undefined;
}) {
  return render(
    <WindowMenuProvider>
      <ExplorerSyncLanesPanel
        domainScope={input.domainScope}
        embedded
        onBackToSelectionRoute={() => undefined}
        onBackToSyncLanesRoute={() => undefined}
        onOpenLaneDetail={() => undefined}
        selectedLaneKey={input.selectedLaneKey ?? null}
      />
      <ToolbarProbe />
    </WindowMenuProvider>,
  );
}

// The compact list keys off `useRoutedLayoutTier`, which reads the
// `(min-width: 760px)` media query. Force it to a phone-tier miss and leave the
// stub installed so later interactions and async re-renders keep resolving to
// the compact list; `afterEach` tears it down via the returned restore.
function stubPhoneMatchMedia() {
  const originalMatchMedia = window.matchMedia;
  restorePhoneMatchMedia = () => {
    window.matchMedia = originalMatchMedia;
  };
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderSyncLanesPanelOnPhone(input: {
  onOpenLaneDetail?: ((laneKey: string) => void) | undefined;
  snapshot: DomainSyncSnapshot;
}) {
  stubPhoneMatchMedia();
  return renderSyncLanesPanel(input);
}

test("ExplorerSyncLanesPanelView renders lane status, progress, and counts", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      lastAction: "started",
      phase: "document",
      requestCount: 1,
      runCount: 1,
      running: true,
      status: "running",
    }),
    createLaneSnapshot({
      errorCount: 1,
      key: "documents:local-2",
      label: "Document local-2",
      lastAction: "failed",
      lastError: "boom",
      phase: "document",
      requestCount: 2,
      runCount: 2,
      status: "error",
    }),
  ]);

  const view = renderSyncLanesPanel({ snapshot });

  expect(view.getByText("Sync Lanes")).toBeTruthy();
  expect(view.getByText("Document local-1")).toBeTruthy();
  expect(view.getByText("Document local-2")).toBeTruthy();
  expect(view.getAllByText("Running").length).toBeGreaterThan(0);
  expect(view.getAllByText("Error").length).toBeGreaterThan(0);
  expect(view.getByText("1 request, 1 run, 0 errors")).toBeTruthy();
  expect(view.getByText("2 requests, 2 runs, 1 error")).toBeTruthy();
  expect(
    view.getAllByRole("progressbar")[0]?.getAttribute("aria-valuenow"),
  ).toBe("65");
});

test("ExplorerSyncLanesPanelView opens lane details from the responsive list", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      phase: "document",
    }),
  ]);
  const openedLaneKeys: string[] = [];

  const view = renderSyncLanesPanel({
    onOpenLaneDetail: (laneKey) => {
      openedLaneKeys.push(laneKey);
    },
    snapshot,
  });

  fireEvent.click(
    view.getByRole("button", {
      name: "Open lane detail: Document local-1",
    }),
  );

  expect(openedLaneKeys).toEqual(["documents:local-1"]);
});

test("ExplorerSyncLanesPanelView trims the list to lane and status on phones", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      lastAction: "started",
      phase: "document",
      requestCount: 1,
      runCount: 1,
      running: true,
      status: "running",
    }),
  ]);

  const view = renderSyncLanesPanelOnPhone({ snapshot });

  const headerCells = Array.from(view.container.querySelectorAll("thead th"));
  expect(headerCells.map((cell) => cell.textContent)).toEqual([
    "Lane",
    "Status",
  ]);
  // The lane stays identifiable and the status still reads at a glance...
  expect(view.getByText("Document local-1")).toBeTruthy();
  expect(view.getAllByText("Running").length).toBeGreaterThan(0);
  // ...while the wide-only detail columns and their column menu fall away.
  expect(view.queryByText("1 request, 1 run, 0 errors")).toBeNull();
  expect(view.queryByRole("progressbar")).toBeNull();
  expect(view.queryByRole("button", { name: "Columns" })).toBeNull();
});

test("ExplorerSyncLanesPanelView opens lane details from the compact list", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      phase: "document",
    }),
  ]);
  const openedLaneKeys: string[] = [];

  const view = renderSyncLanesPanelOnPhone({
    onOpenLaneDetail: (laneKey) => {
      openedLaneKeys.push(laneKey);
    },
    snapshot,
  });

  fireEvent.click(
    view.getByRole("button", {
      name: "Open lane detail: Document local-1",
    }),
  );

  expect(openedLaneKeys).toEqual(["documents:local-1"]);
});

test("ExplorerSyncLanesPanelView places the column menu in the rightmost status header", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "documents:local-1",
      label: "Document local-1",
      phase: "document",
      status: "running",
    }),
  ]);

  const view = renderSyncLanesPanel({ snapshot });
  const headerCells = Array.from(view.container.querySelectorAll("thead th"));
  const columnsButton = view.getByRole("button", { name: "Columns" });

  expect(headerCells.at(-1)?.textContent).toContain("Status");
  expect(headerCells.at(-1)?.contains(columnsButton)).toBe(true);

  fireEvent.click(columnsButton);
  fireEvent.click(view.getByRole("checkbox", { name: /Progress/u }));

  expect(view.queryByRole("progressbar")).toBeNull();
});

test("ExplorerSyncLanesPanel triggers a manual sync from the toolbar action", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let runCount = 0;
  coordinator.registerLane("lane-a", {
    run: async () => {
      runCount += 1;
    },
  });

  const view = renderSyncLanesPanelContainer({ domainScope });

  const button = await view.findByRole("button", {
    name: EXPLORER_LABELS.syncLanesSyncNowAction,
  });
  fireEvent.click(button);

  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      quietMs: 0,
      timeoutMs: 1_000,
    }),
  ).toBe(true);
  expect(runCount).toBe(1);
});

test("ExplorerSyncLanesPanel disables the toolbar action while syncing", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let releaseLane: () => void = () => undefined;
  coordinator.registerLane("lane-a", {
    run: () =>
      new Promise<void>((resolve) => {
        releaseLane = resolve;
      }),
  });
  // Kick off a sync that stays in flight so the snapshot reports pending work.
  requestAllDomainSyncLanes(domainScope);

  const view = renderSyncLanesPanelContainer({ domainScope });

  const button = (await view.findByRole("button", {
    name: EXPLORER_LABELS.syncLanesSyncNowAction,
  })) as HTMLButtonElement;
  await waitFor(() => {
    expect(button.disabled).toBe(true);
  });

  releaseLane();
  await waitForDomainSyncCoordinatorToSettle(domainScope, {
    quietMs: 0,
    timeoutMs: 1_000,
  });
});

test("ExplorerSyncLanesPanel drops the toolbar action in lane detail", async () => {
  const view = renderSyncLanesPanelContainer({
    domainScope: createDomainScope(),
    selectedLaneKey: "documents:local-1",
  });

  // The lane-detail header renders, but no manual-sync toolbar action registers.
  await view.findByText(EXPLORER_LABELS.syncLanesDetailTitle);
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.syncLanesSyncNowAction,
    }),
  ).toBeNull();
});

test("ExplorerSyncLanesPanelView renders lane detail metadata", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      errorCount: 1,
      key: "documents:local-2",
      label: "Document local-2",
      lastAction: "failed",
      lastCompletedAt: "2026-06-15T12:02:00.000Z",
      lastError: "boom",
      lastFailedAt: "2026-06-15T12:03:00.000Z",
      lastRequestedAt: "2026-06-15T12:00:30.000Z",
      lastStartedAt: "2026-06-15T12:01:00.000Z",
      phase: "document",
      registrationIndex: 4,
      requestCount: 2,
      requested: true,
      runCount: 2,
      status: "error",
    }),
  ]);

  const view = renderSyncLanesPanel({
    selectedLaneKey: "documents:local-2",
    snapshot,
  });

  expect(view.getByText("Sync Lane Detail")).toBeTruthy();
  expect(view.getByText("Lane Details")).toBeTruthy();
  expect(view.getByText("Timing")).toBeTruthy();
  expect(view.getByText("Coordinator")).toBeTruthy();
  expect(view.getByText("documents:local-2")).toBeTruthy();
  expect(view.getByText("4")).toBeTruthy();
  expect(view.getByText("boom")).toBeTruthy();
  expect(view.getByText("Pending Work")).toBeTruthy();
  expect(view.getByText("Pump Active")).toBeTruthy();
});

test("ExplorerSyncLanesPanelView renders real multipart upload progress", () => {
  const snapshot = createSnapshot([
    createLaneSnapshot({
      key: "blob-upload:slot-1",
      label: "Upload report.pdf",
      lastAction: "started",
      phase: "blob",
      progress: {
        bytesTotal: 40 * 1024 * 1024,
        bytesUploaded: 24 * 1024 * 1024,
        partsCompleted: 3,
        partsTotal: 5,
      },
      requestCount: 0,
      runCount: 1,
      running: true,
      status: "running",
    }),
  ]);

  const view = renderSyncLanesPanel({ snapshot });

  expect(view.getByText("Upload report.pdf")).toBeTruthy();
  expect(view.getByText("Blob")).toBeTruthy();
  // 24 MiB of 40 MiB ≈ 60%, derived from bytes rather than the status fallback.
  expect(
    view.getAllByRole("progressbar")[0]?.getAttribute("aria-valuenow"),
  ).toBe("60");
  expect(view.getByText(/3\/5 parts/)).toBeTruthy();
});

test("ExplorerSyncLanesPanelView renders the empty state", () => {
  const view = renderSyncLanesPanel({ snapshot: createSnapshot([]) });

  expect(view.getByText("No sync lanes.")).toBeTruthy();
});

test("getExplorerSyncLaneProgress maps lane statuses to determinate values", () => {
  expect(getExplorerSyncLaneProgress("idle")).toBe(0);
  expect(getExplorerSyncLaneProgress("queued")).toBe(25);
  expect(getExplorerSyncLaneProgress("running")).toBe(65);
  expect(getExplorerSyncLaneProgress("complete")).toBe(100);
  expect(getExplorerSyncLaneProgress("error")).toBe(100);
});
