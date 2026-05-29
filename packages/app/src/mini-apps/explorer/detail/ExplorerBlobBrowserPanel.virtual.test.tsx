import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobInfoInput, BlobStore } from "@tearleads/client-sdk";
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
});
