import { afterEach, expect, test } from "bun:test";
import type {
  BlobInfo,
  BlobInfoDocumentReference,
  BlobInfoInput,
  BlobStore,
} from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";

afterEach(() => {
  cleanup();
  // A test that enables a column writes the preference; leave the next one the
  // defaults it expects.
  globalThis.localStorage.clear();
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
      organizationId: null,
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
    openByteSource: async () => null,
    readBytes: async () => null,
    writeByteSource: async () => undefined,
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

test("blob browser opens list rows in the detail screen", async () => {
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
      loadBlobInfo={loadBlobInfo}
      nodes={[]}
      online={true}
      onCancelBlobPick={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null }}
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

  // Clicking the row button opens detail.
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
      online={true}
      onCancelBlobPick={() => undefined}
      openDocumentInfoRoute={(localId, containerId) => {
        openedInfoRoutes.push([localId, containerId]);
      }}
      route={{ blobId: "blob-1", storageKey: null }}
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

test("blob browser requests a new blob window when the table scrolls", async () => {
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
      loadBlobInfo={loadBlobInfo}
      nodes={[]}
      online={true}
      onCancelBlobPick={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null }}
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
      loadBlobInfo={loadBlobInfo}
      nodes={[]}
      online={true}
      onCancelBlobPick={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null }}
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
      loadBlobInfo={loadBlobInfo}
      nodes={[]}
      online={true}
      onCancelBlobPick={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null }}
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

test("blob browser renders row sync badges in the rightmost column", async () => {
  const rows = createBlobRows(1);
  const firstRow = rows[0] as BlobInfo;
  rows[0] = {
    ...firstRow,
    blobId: null,
    key: "storage:storage-1",
    references: [
      createBlobReference({ attachmentKind: "pending", blobId: null }),
    ],
  };

  const view = render(
    <ExplorerBlobBrowserPanel
      blobStore={createBlobStore()}
      loadBlobInfo={async () => ({ rows, totalCount: rows.length })}
      nodes={[]}
      online={true}
      onCancelBlobPick={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null }}
      selectDocumentProjection={() => undefined}
    />,
  );

  // Sync is hidden by default (a folded row spends the width on its two lines),
  // so wait on the row itself and then enable the column.
  expect(await view.findByRole("button", { name: "storage-1" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Columns" }));
  fireEvent.click(view.getByRole("checkbox", { name: "Sync Off" }));

  expect(view.getByRole("img", { name: /1 blob/u })).toBeTruthy();
  expect(view.queryByText("Sync Status")).toBeNull();
  const headerCells = Array.from(view.container.querySelectorAll("thead th"));
  const lastHeader = headerCells.at(-1);
  expect(lastHeader?.textContent).toContain("Sync");
  expect(lastHeader?.querySelector("button")?.title).toBe("Columns");
});
