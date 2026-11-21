import { afterEach, expect, test } from "bun:test";
import {
  type CompletedDownloadItem,
  type ContainerDocumentQueries,
  createDomainScope,
  type DomainScope,
  type DownloadQueueItemRef,
  getOrCreateDomainSyncCoordinator,
  type PendingDownloadQueueItem,
  waitForDomainSyncCoordinatorToSettle,
} from "@tearleads/client-sdk";
import {
  useWindowRefreshMenuItem,
  useWindowRefreshMenuItemValue,
  WindowMenuProvider,
} from "@tearleads/windowing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { ExplorerDownloadsPanel } from "./ExplorerDownloadsPanel";

afterEach(cleanup);

function ToolbarProbe() {
  const refresh = useWindowRefreshMenuItemValue();
  return refresh ? (
    <button disabled={refresh.disabled} onClick={refresh.onClick} type="button">
      {refresh.label}
    </button>
  ) : null;
}

// Stands in for the Explorer's own reconciliation Refresh, which the view
// under it overrides while open.
function ExplorerRefresh(params: { onRefresh: () => void }) {
  useWindowRefreshMenuItem({ onRefresh: params.onRefresh, priority: 100 });
  return null;
}

function queueItem(localId: string, title: string): PendingDownloadQueueItem {
  return {
    documentId: `remote-${localId}`,
    lastError: null,
    localId,
    objectKind: "document",
    reason: "continuation",
    title,
  };
}

function createQueue() {
  const queue = {
    completed: new Set<string>(),
    items: [queueItem("alpha", "Alpha"), queueItem("beta", "Beta")],
  };
  const documentQueries = {
    listCompletedDownloads: async (
      refs: ReadonlyArray<DownloadQueueItemRef>,
    ): Promise<ReadonlyArray<CompletedDownloadItem>> =>
      refs.flatMap((ref) =>
        queue.completed.has(ref.localId)
          ? [
              {
                documentId: `remote-${ref.localId}`,
                localId: ref.localId,
                objectKind: ref.objectKind,
                title: ref.localId === "alpha" ? "Alpha" : "Beta",
              },
            ]
          : [],
      ),
    listPendingDownloads: async () => queue.items,
  } as unknown as ContainerDocumentQueries;
  return { documentQueries, queue };
}

function renderDownloads(input: {
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  onExplorerRefresh?: () => void;
  showDownloads?: boolean;
}) {
  return (
    <WindowMenuProvider>
      <ExplorerRefresh onRefresh={input.onExplorerRefresh ?? (() => {})} />
      {input.showDownloads === false ? null : (
        <ExplorerDownloadsPanel
          documentListRevision={0}
          documentQueries={input.documentQueries}
          domainScope={input.domainScope}
          nodes={[]}
          online
          isAuthenticated
        />
      )}
      <ToolbarProbe />
    </WindowMenuProvider>
  );
}

// Lane runs update the snapshot outside React, so settle them inside act.
async function refreshAndSettle(
  view: ReturnType<typeof render>,
  domainScope: DomainScope,
): Promise<boolean> {
  let settled = false;
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Refresh" }));
    settled = await waitForDomainSyncCoordinatorToSettle(domainScope, {
      quietMs: 0,
      timeoutMs: 1_000,
    });
  });
  return settled;
}

function getRow(view: ReturnType<typeof render>, name: string): HTMLElement {
  const row = view.getByText(name).closest("tr");
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${name}`);
  return row;
}

function expectRow(
  view: ReturnType<typeof render>,
  name: string,
  expected: { percent: string; status: string },
) {
  const row = within(getRow(view, name));
  expect(row.getByText(expected.status)).toBeTruthy();
  expect(row.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    expected.percent,
  );
}

test("a download that finishes stays Complete across a view switch and refresh", async () => {
  const domainScope = createDomainScope();
  const { documentQueries, queue } = createQueue();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  coordinator.registerLane("documents:alpha", {
    run: async () => {
      queue.items = queue.items.filter((item) => item.localId !== "alpha");
      queue.completed.add("alpha");
    },
  });
  coordinator.registerLane("documents:beta", {
    run: async () => {
      queue.items = queue.items.map((item) =>
        item.localId === "beta"
          ? { ...item, lastError: "Unable to fetch content" }
          : item,
      );
    },
  });
  const view = render(renderDownloads({ documentQueries, domainScope }));
  await waitFor(() =>
    expect(view.getByText("2 pending downloads")).toBeTruthy(),
  );
  expectRow(view, "Alpha", { percent: "25", status: "More pages pending" });

  expect(await refreshAndSettle(view, domainScope)).toBe(true);
  await waitFor(() =>
    expect(view.getByText("1 pending download")).toBeTruthy(),
  );
  await waitFor(() =>
    expectRow(view, "Alpha", { percent: "100", status: "Complete" }),
  );
  expectRow(view, "Beta", { percent: "25", status: "Sync error" });
  expect(view.getByText("Unable to fetch content")).toBeTruthy();
  expect(view.getAllByText("Complete")).toHaveLength(1);

  // Switch to another Explorer view, then back, and refresh again.
  view.rerender(
    renderDownloads({ documentQueries, domainScope, showDownloads: false }),
  );
  expect(view.queryByText("Alpha")).toBeNull();
  view.rerender(renderDownloads({ documentQueries, domainScope }));
  expectRow(view, "Alpha", { percent: "100", status: "Complete" });
  expect(await refreshAndSettle(view, domainScope)).toBe(true);
  await waitFor(() =>
    expect(view.getByText("1 pending download")).toBeTruthy(),
  );
  expect(view.getAllByText("Alpha")).toHaveLength(1);
  expectRow(view, "Alpha", { percent: "100", status: "Complete" });
  expectRow(view, "Beta", { percent: "25", status: "Sync error" });
});

test("a download that finishes while Downloads is closed is Complete on return", async () => {
  const domainScope = createDomainScope();
  const { documentQueries, queue } = createQueue();
  const view = render(renderDownloads({ documentQueries, domainScope }));
  await waitFor(() =>
    expect(view.getByText("2 pending downloads")).toBeTruthy(),
  );
  view.rerender(
    renderDownloads({ documentQueries, domainScope, showDownloads: false }),
  );
  queue.items = queue.items.filter((item) => item.localId !== "beta");
  queue.completed.add("beta");
  view.rerender(renderDownloads({ documentQueries, domainScope }));
  await waitFor(() =>
    expectRow(view, "Beta", { percent: "100", status: "Complete" }),
  );
  expect(view.getByText("1 pending download")).toBeTruthy();
});

test("Downloads owns the toolbar Refresh only while it is open", async () => {
  const domainScope = createDomainScope();
  const { documentQueries } = createQueue();
  let laneRuns = 0;
  getOrCreateDomainSyncCoordinator(domainScope).registerLane("lane", {
    run: async () => {
      laneRuns += 1;
    },
  });
  let explorerRefreshes = 0;
  const onExplorerRefresh = () => {
    explorerRefreshes += 1;
  };
  const view = render(
    renderDownloads({ documentQueries, domainScope, onExplorerRefresh }),
  );
  await view.findByRole("button", { name: "Refresh" });
  expect(await refreshAndSettle(view, domainScope)).toBe(true);
  expect(laneRuns).toBe(1);
  expect(explorerRefreshes).toBe(0);

  view.rerender(
    renderDownloads({
      documentQueries,
      domainScope,
      onExplorerRefresh,
      showDownloads: false,
    }),
  );
  fireEvent.click(view.getByRole("button", { name: "Refresh" }));
  expect(explorerRefreshes).toBe(1);
  expect(laneRuns).toBe(1);
});
