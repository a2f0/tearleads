import { afterEach, expect, test } from "bun:test";
import type {
  BlobInfo,
  BlobInfoDocumentReference,
  BlobInfoInput,
  BlobStore,
} from "@tearleads/client-sdk";
import {
  createDomainScope,
  getOrCreateDomainSyncCoordinator,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";

const resizeObserverGlobal = globalThis as unknown as {
  ResizeObserver?: unknown;
};
const originalResizeObserver = resizeObserverGlobal.ResizeObserver;

afterEach(() => {
  cleanup();
  resizeObserverGlobal.ResizeObserver = originalResizeObserver;
});

function createBlobRows(count: number): BlobInfo[] {
  return Array.from({ length: count }, (_, index) => {
    const rowNumber = index + 1;
    return {
      blobId: `blob-${rowNumber}`,
      byteLength: rowNumber,
      createdAt: null,
      documentCount: 1,
      key: `blob:blob-${rowNumber}`,
      mimeType: rowNumber % 2 === 0 ? "image/png" : "text/plain",
      name: null,
      referenceCount: 0,
      references: [],
      storageKey: `storage-${rowNumber}`,
      updatedAt: `2026-05-17T00:${String(index).padStart(2, "0")}:00.000Z`,
    };
  });
}

function createBlobStore(): BlobStore {
  return {
    deleteBytes: async () => undefined,
    readBytes: async () => null,
    writeBytes: async () => undefined,
  };
}

function createBlobReference(
  overrides: Partial<BlobInfoDocumentReference> = {},
): BlobInfoDocumentReference {
  return {
    attachmentKind: "local",
    blobId: "blob-1",
    byteLength: 1,
    containerId: "container-1",
    createdAt: null,
    documentId: "document-1",
    documentKind: "note",
    documentTitle: "Linked Note",
    localId: "local-document-1",
    mimeType: "text/plain",
    name: "linked-note.txt",
    slotId: "slot-1",
    storageKey: "storage-1",
    updatedAt: null,
    ...overrides,
  };
}

test("blob browser navigates between the list and detail screens", async () => {
  const rows = createBlobRows(3);
  const loadBlobInfo = async (
    input: BlobInfoInput = {},
  ): Promise<{ rows: BlobInfo[]; totalCount: number }> => {
    const limit = input.limit ?? 24;
    const offset = input.offset ?? 0;
    return {
      rows: rows.slice(offset, offset + limit),
      totalCount: rows.length,
    };
  };
  const view = render(
    <ExplorerBlobBrowserPanel
      blobStore={createBlobStore()}
      domainScope={createDomainScope()}
      loadBlobInfo={loadBlobInfo}
      nodes={[]}
      onBackToSelectionRoute={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null, view: "blob-browser" }}
      selectDocumentProjection={() => undefined}
    />,
  );

  // List screen: the table is visible, the detail metadata heading is not.
  await waitFor(() => {
    expect(
      view.container.querySelector(".explorer-blob-browser-table-wrap"),
    ).toBeTruthy();
  });
  expect(view.queryByText("Blob Metadata")).toBeNull();

  // The row button stretches across the row so clicking any visible blob row
  // area opens detail.
  const blobButton = view.getByRole("button", { name: "blob-1" });
  expect(
    blobButton.classList.contains("explorer-blob-browser-row-button"),
  ).toBe(true);
  expect(
    blobButton
      .closest("tr")
      ?.classList.contains("explorer-blob-browser-table-row"),
  ).toBe(true);
  fireEvent.click(blobButton);

  await waitFor(() => {
    expect(view.getByText("Blob Metadata")).toBeTruthy();
  });
  expect(
    view.container.querySelector(".explorer-blob-browser-table-wrap"),
  ).toBeNull();

  // The back button returns to the list screen.
  fireEvent.click(view.getByRole("button", { name: "Back to List" }));

  await waitFor(() => {
    expect(
      view.container.querySelector(".explorer-blob-browser-table-wrap"),
    ).toBeTruthy();
  });
  expect(view.queryByText("Blob Metadata")).toBeNull();
});

test("blob browser document links open documents and expose get info from the row context menu", async () => {
  const rows = createBlobRows(1);
  const firstRow = rows[0];
  if (!firstRow) {
    throw new Error("Expected a blob row.");
  }
  rows[0] = {
    ...firstRow,
    references: [createBlobReference()],
  };
  const selectedDocuments: Array<[string, string]> = [];
  const openedInfoRoutes: Array<[string, string]> = [];
  const loadBlobInfo = async (): Promise<{
    rows: BlobInfo[];
    totalCount: number;
  }> => ({
    rows,
    totalCount: rows.length,
  });
  const view = render(
    <ExplorerBlobBrowserPanel
      blobStore={createBlobStore()}
      domainScope={createDomainScope()}
      loadBlobInfo={loadBlobInfo}
      nodes={[
        {
          id: "container-1",
          kind: "container",
          name: "Projects",
          organizationId: "org-1",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
      ]}
      onBackToSelectionRoute={() => undefined}
      openDocumentInfoRoute={(localId, containerId) => {
        openedInfoRoutes.push([localId, containerId]);
      }}
      route={{ blobId: "blob-1", storageKey: null, view: "blob-browser" }}
      selectDocumentProjection={(localId, containerId) => {
        selectedDocuments.push([localId, containerId]);
      }}
    />,
  );

  const documentLink = await view.findByRole("button", {
    name: "Linked Note",
  });
  expect(
    documentLink.classList.contains("explorer-blob-reference-row-button"),
  ).toBe(true);
  const row = documentLink.closest("tr");
  expect(row?.classList.contains("mini-app-table-row--interactive")).toBe(true);

  fireEvent.click(documentLink);
  expect(selectedDocuments).toEqual([["local-document-1", "container-1"]]);

  fireEvent.contextMenu(row ?? documentLink, { clientX: 24, clientY: 32 });
  await waitFor(() => {
    expect(
      document.body.querySelector<HTMLButtonElement>(".menu button")
        ?.textContent,
    ).toBe("Get Info");
  });
  const getInfo =
    document.body.querySelector<HTMLButtonElement>(".menu button");
  if (!getInfo) {
    throw new Error("Expected the document-link context menu to open.");
  }
  expect(getInfo?.textContent).toBe("Get Info");
  fireEvent.click(getInfo);

  expect(openedInfoRoutes).toEqual([["local-document-1", "container-1"]]);
});

test("blob browser returns to the list from a deep-linked detail screen", async () => {
  const rows = createBlobRows(3);
  const loadBlobInfo = async (
    input: BlobInfoInput = {},
  ): Promise<{ rows: BlobInfo[]; totalCount: number }> => {
    const limit = input.limit ?? 24;
    const offset = input.offset ?? 0;
    return {
      rows: rows.slice(offset, offset + limit),
      totalCount: rows.length,
    };
  };
  // Deep-link straight to a blob's detail screen via the route.
  const view = render(
    <ExplorerBlobBrowserPanel
      blobStore={createBlobStore()}
      domainScope={createDomainScope()}
      loadBlobInfo={loadBlobInfo}
      nodes={[]}
      onBackToSelectionRoute={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: "blob-2", storageKey: null, view: "blob-browser" }}
      selectDocumentProjection={() => undefined}
    />,
  );

  await waitFor(() => {
    expect(view.getByText("Blob Metadata")).toBeTruthy();
  });

  // Back to List must escape the deep-linked detail, not stay stuck on it.
  fireEvent.click(view.getByRole("button", { name: "Back to List" }));

  await waitFor(() => {
    expect(
      view.container.querySelector(".explorer-blob-browser-table-wrap"),
    ).toBeTruthy();
  });
  expect(view.queryByText("Blob Metadata")).toBeNull();
});

test("blob browser requests a new blob window when the table scrolls", async () => {
  resizeObserverGlobal.ResizeObserver = undefined;
  const rows = createBlobRows(80);
  const calls: BlobInfoInput[] = [];
  const loadBlobInfo = async (
    input: BlobInfoInput = {},
  ): Promise<{ rows: BlobInfo[]; totalCount: number }> => {
    calls.push(input);
    const limit = input.limit ?? 24;
    const offset = input.offset ?? 0;
    return {
      rows: rows.slice(offset, offset + limit),
      totalCount: rows.length,
    };
  };
  const view = render(
    <ExplorerBlobBrowserPanel
      blobStore={createBlobStore()}
      domainScope={createDomainScope()}
      loadBlobInfo={loadBlobInfo}
      nodes={[]}
      onBackToSelectionRoute={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null, view: "blob-browser" }}
      selectDocumentProjection={() => undefined}
    />,
  );

  await waitFor(() => {
    expect(calls).toEqual([
      {
        limit: 24,
        offset: 0,
        query: "",
        sort: { direction: "desc", key: "updated" },
      },
    ]);
  });

  const frame = view.container.querySelector<HTMLDivElement>(
    ".explorer-blob-browser-table-wrap",
  );
  expect(frame).toBeTruthy();
  if (!frame) {
    throw new Error("Blob browser table frame was not rendered.");
  }

  frame.scrollTop = 720;
  fireEvent.scroll(frame);

  await waitFor(() => {
    expect(calls.at(-1)).toEqual({
      limit: 24,
      offset: 12,
      query: "",
      sort: { direction: "desc", key: "updated" },
    });
  });
});

test("blob browser keeps current rows visible while the next scroll window loads", async () => {
  resizeObserverGlobal.ResizeObserver = undefined;
  const rows = createBlobRows(80);
  const calls: BlobInfoInput[] = [];
  let resolveScrolledWindow:
    | ((value: { rows: BlobInfo[]; totalCount: number }) => void)
    | undefined;
  const loadBlobInfo = async (
    input: BlobInfoInput = {},
  ): Promise<{ rows: BlobInfo[]; totalCount: number }> => {
    calls.push(input);
    const limit = input.limit ?? 24;
    const offset = input.offset ?? 0;
    if (calls.length === 1) {
      return {
        rows: rows.slice(offset, offset + limit),
        totalCount: rows.length,
      };
    }

    return new Promise((resolve) => {
      resolveScrolledWindow = resolve;
    });
  };
  const view = render(
    <ExplorerBlobBrowserPanel
      blobStore={createBlobStore()}
      domainScope={createDomainScope()}
      loadBlobInfo={loadBlobInfo}
      nodes={[]}
      onBackToSelectionRoute={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null, view: "blob-browser" }}
      selectDocumentProjection={() => undefined}
    />,
  );

  expect(await view.findByRole("button", { name: "blob-1" })).toBeTruthy();

  const frame = view.container.querySelector<HTMLDivElement>(
    ".explorer-blob-browser-table-wrap",
  );
  expect(frame).toBeTruthy();
  if (!frame) {
    throw new Error("Blob browser table frame was not rendered.");
  }

  frame.scrollTop = 720;
  fireEvent.scroll(frame);

  await waitFor(() => {
    expect(calls.at(-1)?.offset).toBe(12);
  });
  expect(view.getByRole("button", { name: "blob-1" })).toBeTruthy();

  await act(async () => {
    resolveScrolledWindow?.({
      rows: rows.slice(12, 36),
      totalCount: rows.length,
    });
  });

  expect(await view.findByRole("button", { name: "blob-13" })).toBeTruthy();
});

test("blob browser resets the blob window when sorting changes", async () => {
  resizeObserverGlobal.ResizeObserver = undefined;
  const rows = createBlobRows(80);
  const calls: BlobInfoInput[] = [];
  let resolveSortedWindow:
    | ((value: { rows: BlobInfo[]; totalCount: number }) => void)
    | undefined;
  const loadBlobInfo = async (
    input: BlobInfoInput = {},
  ): Promise<{ rows: BlobInfo[]; totalCount: number }> => {
    calls.push(input);
    const limit = input.limit ?? 24;
    const offset = input.offset ?? 0;
    if (input.sort?.key === "mimeType") {
      return new Promise((resolve) => {
        resolveSortedWindow = resolve;
      });
    }

    return {
      rows: rows.slice(offset, offset + limit),
      totalCount: rows.length,
    };
  };
  const view = render(
    <ExplorerBlobBrowserPanel
      blobStore={createBlobStore()}
      domainScope={createDomainScope()}
      loadBlobInfo={loadBlobInfo}
      nodes={[]}
      onBackToSelectionRoute={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null, view: "blob-browser" }}
      selectDocumentProjection={() => undefined}
    />,
  );

  await waitFor(() => {
    expect(calls.length).toBe(1);
  });

  const frame = view.container.querySelector<HTMLDivElement>(
    ".explorer-blob-browser-table-wrap",
  );
  expect(frame).toBeTruthy();
  if (!frame) {
    throw new Error("Blob browser table frame was not rendered.");
  }

  frame.scrollTop = 720;
  fireEvent.scroll(frame);
  await waitFor(() => {
    expect(calls.at(-1)?.offset).toBe(12);
  });

  fireEvent.click(view.getByRole("button", { name: "MIME" }));

  await waitFor(() => {
    expect(calls.filter((call) => call.sort?.key === "mimeType")).toEqual([
      {
        limit: 24,
        offset: 0,
        query: "",
        sort: { direction: "asc", key: "mimeType" },
      },
    ]);
  });
  expect(view.queryByText("No blobs.")).toBeNull();

  await act(async () => {
    resolveSortedWindow?.({
      rows: rows.slice(0, 24),
      totalCount: rows.length,
    });
  });
});

test("blob browser renders upload sync status", async () => {
  const rows = createBlobRows(1);
  const domainScope = createDomainScope();
  const lane = getOrCreateDomainSyncCoordinator(domainScope).beginUploadLane(
    "blob-upload:slot-zip",
    {
      label: "Upload archive.zip",
    },
  );
  lane.reportProgress({
    bytesTotal: 40 * 1024 * 1024,
    bytesUploaded: 8 * 1024 * 1024,
    partsCompleted: 1,
    partsTotal: 5,
  });

  const view = render(
    <ExplorerBlobBrowserPanel
      blobStore={createBlobStore()}
      domainScope={domainScope}
      loadBlobInfo={async () => ({ rows, totalCount: rows.length })}
      nodes={[]}
      onBackToSelectionRoute={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null, view: "blob-browser" }}
      selectDocumentProjection={() => undefined}
    />,
  );

  expect(await view.findByText("Sync Status")).toBeTruthy();
  expect(view.getByText("Upload archive.zip")).toBeTruthy();
  expect(view.getByText(/1\/5 parts/u)).toBeTruthy();
});
