import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  type CompletedDownloadItem,
  type ContainerDocumentQueries,
  createDomainScope,
  getOrCreateDomainDownloadHistory,
  type PendingDownloadQueueItem,
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
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerDownloadsPanel } from "./ExplorerDownloadsPanel";

let tearleadsSpy: ReturnType<typeof spyOn> | null = null;

beforeEach(() => {
  tearleadsSpy = spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
    documents: { retryDownload: async () => true },
  } as unknown as Tearleads);
});

afterEach(() => {
  cleanup();
  tearleadsSpy?.mockRestore();
});

const PENDING: ReadonlyArray<PendingDownloadQueueItem> = [
  {
    documentId: "remote-notes",
    lastError: null,
    localId: "notes",
    objectKind: "document",
    reason: "initial",
    title: null,
  },
  {
    documentId: "remote-stray",
    lastError: null,
    localId: "stray",
    objectKind: "document",
    reason: "initial",
    title: null,
  },
  {
    documentId: "remote-projects",
    lastError: null,
    localId: "projects",
    objectKind: "container",
    reason: "initial",
    title: null,
  },
  {
    documentId: "remote-drill",
    fileName: "drill.png",
    lastError: null,
    localId: "drill",
    objectKind: "attachment",
    reason: "initial",
    slotId: "photo",
    title: "Drill",
  },
  {
    documentId: "remote-saw",
    fileName: "saw.png",
    lastError: null,
    localId: "saw",
    objectKind: "attachment",
    reason: "initial",
    slotId: "photo",
    title: "Saw",
  },
];

const STORED: ReadonlyArray<CompletedDownloadItem> = [
  {
    containerId: "folder-1",
    documentId: "remote-notes",
    localId: "notes",
    objectKind: "document",
    title: "Notes",
  },
  // Orphaned: no folder route shows it.
  {
    containerId: null,
    documentId: "remote-stray",
    localId: "stray",
    objectKind: "document",
    title: "Stray",
  },
  {
    documentId: "remote-projects",
    localId: "projects",
    objectKind: "container",
    title: "Projects",
  },
  {
    blobId: "drill-blob",
    containerId: "tools",
    documentId: "remote-drill",
    fileName: "drill.png",
    localId: "drill",
    objectKind: "attachment",
    slotId: "photo",
    storageKey: "blob-drill",
    title: "Drill",
  },
];

test("a finished download opens its blob, document, or folder", async () => {
  // The saw's photo is still downloading.
  let items = PENDING;
  const documentQueries = {
    listPendingDownloads: async () => items,
  } as unknown as ContainerDocumentQueries;
  const opened: string[] = [];
  const destinations = {
    openBlobDetail: (storageKey: string) => opened.push(`blob ${storageKey}`),
    openContainerInfoRoute: (containerId: string) =>
      opened.push(`folder ${containerId}`),
    openDocumentInfoRoute: (localId: string, containerId: string) =>
      opened.push(`document ${containerId}/${localId}`),
  };
  const domainScope = createDomainScope();
  const view = render(
    <ExplorerDownloadsPanel
      destinations={destinations}
      dbReady
      documentQueries={documentQueries}
      domainScope={domainScope}
      online
      isAuthenticated
    />,
  );
  await waitFor(() => expect(view.getByText("drill.png")).toBeTruthy());
  // Nothing is open while it is still downloading.
  expect(
    view.queryByRole("button", {
      name: `${EXPLORER_LABELS.downloadsOpenFileAction}: drill.png`,
    }),
  ).toBeNull();

  // The SDK records each finished download as it leaves the queue, and each
  // recorded completion re-reads the queue.
  await act(async () => {
    items = PENDING.filter((item) => item.localId === "saw");
    const history = getOrCreateDomainDownloadHistory(domainScope);
    for (const item of STORED) history.recordCompleted(item);
  });
  await waitFor(() => expect(view.getAllByText("Complete")).toHaveLength(4));

  // The name is the keyboard target; a click anywhere on the row follows it.
  fireEvent.click(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.downloadsOpenFileAction}: drill.png`,
    }),
  );
  const notesRow = view.getByText("Notes").closest("tr");
  if (!notesRow) throw new Error("Expected the Notes row");
  fireEvent.click(notesRow);
  fireEvent.click(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.downloadsOpenFolderAction}: Projects`,
    }),
  );
  expect(opened).toEqual([
    "blob blob-drill",
    "document folder-1/notes",
    "folder projects",
  ]);

  // An orphaned document and a file still downloading stay plain rows.
  const strayRow = view.getByText("Stray").closest("tr");
  if (!strayRow) throw new Error("Expected the Stray row");
  fireEvent.click(strayRow);
  const sawRow = view.getByText("saw.png").closest("tr");
  if (!sawRow) throw new Error("Expected the saw row");
  fireEvent.click(sawRow);
  expect(opened).toHaveLength(3);
  expect(
    view.queryByRole("button", { name: /: Stray$|: saw\.png$/ }),
  ).toBeNull();
});
