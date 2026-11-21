import { afterEach, expect, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
  getOrCreateDomainSyncCoordinator,
  type PendingDownloadQueueItem,
} from "@tearleads/client-sdk";
import {
  useWindowRefreshMenuItemValue,
  WindowMenuProvider,
} from "@tearleads/windowing";
import { act, cleanup, render, waitFor } from "@testing-library/react";
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

test("Downloads shows unknown items and failures, then drops a row that left unconfirmed", async () => {
  let items: ReadonlyArray<PendingDownloadQueueItem> = [
    {
      localId: "local",
      documentId: "remote",
      objectKind: "document",
      title: null,
      reason: "initial",
      lastError: "Unable to fetch content",
    },
  ];
  const documentQueries = {
    // The row left the queue without its content, as a deletion does.
    listCompletedDownloads: async () => [],
    listPendingDownloads: async () => items,
  } as unknown as ContainerDocumentQueries;
  const domainScope = createDomainScope();
  const lane = getOrCreateDomainSyncCoordinator(domainScope).registerLane(
    "documents:local",
    {
      run: async () => {
        items = [];
      },
    },
  );
  const view = render(
    <ExplorerDownloadsPanel
      documentListRevision={0}
      documentQueries={documentQueries}
      domainScope={domainScope}
      nodes={[]}
      online
      isAuthenticated
    />,
  );
  await waitFor(() =>
    expect(view.getByText("Document awaiting content")).toBeTruthy(),
  );
  expect(view.getByText("Unable to fetch content")).toBeTruthy();
  expect(view.getByText("Sync error")).toBeTruthy();
  expect(view.queryByText("Syncing document...")).toBeNull();
  expect(
    view.queryByRole("button", { name: /Document awaiting content/ }),
  ).toBeNull();
  await act(async () => {
    lane.requestSync();
  });
  await waitFor(() =>
    expect(view.getByText("No pending downloads.")).toBeTruthy(),
  );
  expect(view.queryByText("Document awaiting content")).toBeNull();
});

test("Downloads distinguishes waiting offline from a failed queue read", async () => {
  let fail = false;
  const documentQueries = {
    listPendingDownloads: async () => {
      if (fail) throw new Error("Storage unavailable");
      return [
        {
          localId: "folder",
          documentId: "metadata",
          objectKind: "container",
          title: null,
          reason: "initial",
          lastError: null,
        },
      ];
    },
  } as unknown as ContainerDocumentQueries;
  const domainScope = createDomainScope();
  const renderPanel = (input: {
    documentListRevision: number;
    isAuthenticated: boolean;
  }) => (
    <WindowMenuProvider>
      <ExplorerDownloadsPanel
        documentListRevision={input.documentListRevision}
        documentQueries={documentQueries}
        domainScope={domainScope}
        nodes={[]}
        online={false}
        isAuthenticated={input.isAuthenticated}
      />
      <ToolbarProbe />
    </WindowMenuProvider>
  );
  const view = render(
    renderPanel({ documentListRevision: 0, isAuthenticated: true }),
  );
  await waitFor(() =>
    expect(view.getByText("Waiting for connection")).toBeTruthy(),
  );
  expect(view.getByText("Folder awaiting metadata")).toBeTruthy();
  // The toolbar Refresh replaces Sync now and keeps its offline restriction.
  expect(view.queryByRole("button", { name: "Sync now" })).toBeNull();
  expect(
    view.getByRole("button", { name: "Refresh" }).hasAttribute("disabled"),
  ).toBe(true);
  fail = true;
  view.rerender(
    renderPanel({ documentListRevision: 1, isAuthenticated: false }),
  );
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toBe("Storage unavailable"),
  );
  expect(view.queryByText("No pending downloads.")).toBeNull();
  // The failed read keeps the last rows, and signing out keeps Refresh off.
  expect(view.getByText("Waiting for sign-in")).toBeTruthy();
  expect(
    view.getByRole("button", { name: "Refresh" }).hasAttribute("disabled"),
  ).toBe(true);
});

test("Downloads keeps the title of a hydrated document with pages remaining", async () => {
  const documentQueries = {
    listPendingDownloads: async () => [
      {
        localId: "local",
        documentId: "remote",
        objectKind: "document",
        title: "Holiday.jpg",
        reason: "continuation",
        lastError: null,
      },
    ],
  } as unknown as ContainerDocumentQueries;
  const view = render(
    <ExplorerDownloadsPanel
      documentListRevision={0}
      documentQueries={documentQueries}
      domainScope={createDomainScope()}
      nodes={[]}
      online
      isAuthenticated
    />,
  );
  await waitFor(() => expect(view.getByText("Holiday.jpg")).toBeTruthy());
  expect(view.getByText("More pages pending")).toBeTruthy();
  expect(view.getByText("1 pending download")).toBeTruthy();
});
