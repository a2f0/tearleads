import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
  getOrCreateDomainSyncCoordinator,
  type PendingDownloadQueueItem,
  type RetryDocumentDownloadInput,
  type Tearleads,
} from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import * as TearleadsProvider from "../../../../providers/sdk/TearleadsProvider";
import { ExplorerDownloadsPanel } from "./ExplorerDownloadsPanel";

let retries: RetryDocumentDownloadInput[] = [];
let retryDownload = async (input: RetryDocumentDownloadInput) => {
  retries.push(input);
  return true;
};
let tearleadsSpy: ReturnType<typeof spyOn> | null = null;

beforeEach(() => {
  retries = [];
  retryDownload = async (input) => {
    retries.push(input);
    return true;
  };
  tearleadsSpy = spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
    documents: {
      retryDownload: (input: RetryDocumentDownloadInput) =>
        retryDownload(input),
    },
  } as unknown as Tearleads);
});

afterEach(() => {
  cleanup();
  tearleadsSpy?.mockRestore();
});

test("Downloads shows unknown items and failures, then removes hydrated items", async () => {
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
  const view = render(
    <ExplorerDownloadsPanel
      documentListRevision={0}
      documentQueries={documentQueries}
      domainScope={domainScope}
      nodes={[]}
      online={false}
      isAuthenticated
    />,
  );
  await waitFor(() =>
    expect(view.getByText("Waiting for connection")).toBeTruthy(),
  );
  expect(view.getByText("Folder awaiting metadata")).toBeTruthy();
  expect(
    view.getByRole("button", { name: "Sync now" }).hasAttribute("disabled"),
  ).toBe(true);
  fail = true;
  view.rerender(
    <ExplorerDownloadsPanel
      documentListRevision={1}
      documentQueries={documentQueries}
      domainScope={domainScope}
      nodes={[]}
      online={false}
      isAuthenticated
    />,
  );
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toBe("Storage unavailable"),
  );
  expect(view.queryByText("No pending downloads.")).toBeNull();
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

function attachmentDownload(input: {
  documentId: string;
  fileName: string;
  localId: string;
  slotId: string;
  title: string;
}): PendingDownloadQueueItem {
  return {
    ...input,
    objectKind: "attachment",
    reason: "initial",
    lastError: null,
  };
}

test("Downloads lists first file downloads and retries each document once", async () => {
  const saw = { documentId: "saw-remote", localId: "saw", title: "Saw" };
  const fridge = {
    documentId: "fridge-remote",
    localId: "fridge",
    title: "Refrigerator",
  };
  let items: ReadonlyArray<PendingDownloadQueueItem> = [
    attachmentDownload({ ...saw, fileName: "blade.jpg", slotId: "photos:1" }),
    attachmentDownload({ ...saw, fileName: "side.jpg", slotId: "photos:2" }),
    attachmentDownload({
      ...fridge,
      fileName: "receipt.pdf",
      slotId: "receipt",
    }),
  ];
  const documentQueries = {
    listPendingDownloads: async () => items,
  } as unknown as ContainerDocumentQueries;
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  // The saw's photos arrive on retry while the receipt is still unbound.
  const sawLane = coordinator.registerLane("documents:saw", {
    run: async () => {
      items = items.filter((item) => item.localId !== "saw");
    },
  });
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
  await waitFor(() => expect(view.getByText("blade.jpg")).toBeTruthy());
  expect(view.getByText("side.jpg")).toBeTruthy();
  expect(view.getByText("receipt.pdf")).toBeTruthy();
  expect(view.getAllByText("Saw")).toHaveLength(2);
  expect(view.getByText("Refrigerator")).toBeTruthy();
  expect(view.getAllByText("Waiting for file")).toHaveLength(3);
  expect(view.getByText("3 pending downloads")).toBeTruthy();

  retryDownload = async (input) => {
    retries.push(input);
    if (input.localId === "saw") sawLane.requestSync();
    return true;
  };
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Sync now" }));
  });
  expect(retries).toEqual([
    { documentId: "saw-remote", localId: "saw" },
    { documentId: "fridge-remote", localId: "fridge" },
  ]);
  await waitFor(() =>
    expect(view.getByText("1 pending download")).toBeTruthy(),
  );
  expect(view.queryByText("blade.jpg")).toBeNull();
  expect(view.queryByText("side.jpg")).toBeNull();
  expect(view.getByText("receipt.pdf")).toBeTruthy();
});

test("a failed retry request leaves the file pending", async () => {
  const documentQueries = {
    listPendingDownloads: async () => [
      attachmentDownload({
        documentId: "drill-remote",
        fileName: "drill.png",
        localId: "drill",
        slotId: "photo",
        title: "Drill",
      }),
    ],
  } as unknown as ContainerDocumentQueries;
  retryDownload = async () => {
    throw new Error("database closed");
  };
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
  await waitFor(() => expect(view.getByText("drill.png")).toBeTruthy());
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Sync now" }));
  });
  expect(view.getByText("drill.png")).toBeTruthy();
  expect(view.getByText("1 pending download")).toBeTruthy();
});
