import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
  type DomainScope,
  getOrCreateDomainDownloadHistory,
  getOrCreateDomainSyncCoordinator,
  type PendingDownloadQueueItem,
  type Tearleads,
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
import * as TearleadsProvider from "../../../../providers/sdk/TearleadsProvider";
import {
  type ExplorerDownloadDestinations,
  ExplorerDownloadsPanel,
} from "./ExplorerDownloadsPanel";

const noDestinations: ExplorerDownloadDestinations = {
  openBlobDetail: () => undefined,
  openContainerInfoRoute: () => undefined,
  openDocumentInfoRoute: () => undefined,
};

let tearleadsSpy: ReturnType<typeof spyOn> | null = null;

// These downloads are documents, so Refresh asks for no file retries.
beforeEach(() => {
  tearleadsSpy = spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
    documents: { retryDownload: async () => true },
  } as unknown as Tearleads);
});

afterEach(() => {
  cleanup();
  tearleadsSpy?.mockRestore();
});

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

// A durable queue the SDK finishes pulls from: a finished pull leaves the
// queue and lands in the scope's download history, as the SDK records it.
function createQueue(domainScope: DomainScope) {
  const queue = {
    items: [queueItem("alpha", "Alpha"), queueItem("beta", "Beta")],
  };
  const documentQueries = {
    listPendingDownloads: async () => queue.items,
  } as unknown as ContainerDocumentQueries;
  const finish = (localId: string) => {
    queue.items = queue.items.filter((item) => item.localId !== localId);
    getOrCreateDomainDownloadHistory(domainScope).recordCompleted({
      containerId: "root",
      documentId: `remote-${localId}`,
      localId,
      objectKind: "document",
      title: localId === "alpha" ? "Alpha" : "Beta",
    });
  };
  return { documentQueries, finish, queue };
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
          destinations={noDestinations}
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
  const { documentQueries, finish, queue } = createQueue(domainScope);
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  coordinator.registerLane("documents:alpha", {
    run: async () => {
      finish("alpha");
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
  const { documentQueries, finish } = createQueue(domainScope);
  const view = render(renderDownloads({ documentQueries, domainScope }));
  await waitFor(() =>
    expect(view.getByText("2 pending downloads")).toBeTruthy(),
  );
  view.rerender(
    renderDownloads({ documentQueries, domainScope, showDownloads: false }),
  );
  finish("beta");
  view.rerender(renderDownloads({ documentQueries, domainScope }));
  await waitFor(() =>
    expectRow(view, "Beta", { percent: "100", status: "Complete" }),
  );
  expect(view.getByText("1 pending download")).toBeTruthy();
});

// Downloads that started and finished before any Downloads view opened in
// this scope, as after a reload: the SDK recorded them anyway.
test("downloads that finish before Downloads first opens are listed Complete", async () => {
  const domainScope = createDomainScope();
  const { documentQueries, finish } = createQueue(domainScope);
  finish("alpha");
  finish("beta");
  const view = render(renderDownloads({ documentQueries, domainScope }));
  await waitFor(() =>
    expect(view.getByText("0 pending downloads")).toBeTruthy(),
  );
  expectRow(view, "Alpha", { percent: "100", status: "Complete" });
  expectRow(view, "Beta", { percent: "100", status: "Complete" });
  // Closing and reopening the panel keeps the history, which the SDK owns.
  view.rerender(
    renderDownloads({ documentQueries, domainScope, showDownloads: false }),
  );
  expect(view.queryByText("Alpha")).toBeNull();
  view.rerender(renderDownloads({ documentQueries, domainScope }));
  expect(view.getAllByText("Complete")).toHaveLength(2);
});

test("Downloads owns the toolbar Refresh only while it is open", async () => {
  const domainScope = createDomainScope();
  const { documentQueries } = createQueue(domainScope);
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
