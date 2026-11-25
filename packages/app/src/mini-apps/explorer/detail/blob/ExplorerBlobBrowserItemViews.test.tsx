import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobInfoInput, BlobStore } from "@tearleads/client-sdk";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "@tearleads/windowing";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { BLOB_LIST_LABELS } from "../../../shared/blob-pick/blob-list/blobListLabels";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";

const STORAGE_KEY = "tearleads.blob-browser:item-view";

const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.HTMLElement?.prototype ?? {},
  "clientWidth",
);

afterEach(() => {
  cleanup();
  localStorage.removeItem(STORAGE_KEY);
  if (originalClientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidthDescriptor,
    );
  }
});

// happy-dom has no layout, so stand in for the frame width a browser measures.
function mockFrameWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
}

// rowNumber % 2 === 0 → image/png, so blob-2 is an image and blob-1 is text.
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
      name: `file-${rowNumber}`,
      organizationId: null,
      referenceCount: 0,
      references: [],
      storageKey: `storage-${rowNumber}`,
      updatedAt: "2026-05-17T00:00:00.000Z",
    };
  });
}

const BLOB_STORE: BlobStore = {
  deleteBytes: async () => undefined,
  openByteSource: async () => null,
  readBytes: async () => null,
  writeByteSource: async () => undefined,
  writeBytes: async () => undefined,
};

// Stands in for the window chrome, which renders the registered actions.
function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={action.label}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

async function renderBlobBrowser(
  input: { onPickBlob?: ((blob: BlobInfo) => void) | undefined } = {},
) {
  const rows = createBlobRows(2);
  const requests: Array<{ limit: number; offset: number }> = [];
  const view = render(
    <WindowMenuProvider>
      <ExplorerBlobBrowserPanel
        blobStore={BLOB_STORE}
        loadBlobInfo={async (query: BlobInfoInput = {}) => {
          requests.push({ limit: query.limit ?? 0, offset: query.offset ?? 0 });
          return { rows, totalCount: rows.length };
        }}
        nodes={[]}
        online={true}
        onCancelBlobPick={() => undefined}
        onPickBlob={input.onPickBlob}
        openDocumentInfoRoute={() => undefined}
        pickTarget={
          input.onPickBlob
            ? {
                containerId: "container-1",
                localId: "local-document-1",
                slotAccept: "image",
                slotId: "front-image",
                slotLabel: "Front Image",
              }
            : null
        }
        route={{ blobId: null, storageKey: null }}
        selectDocumentProjection={() => undefined}
      />
      <ToolbarProbe />
    </WindowMenuProvider>,
  );
  await act(async () => undefined);
  return { requests, view };
}

function screenOf(view: ReturnType<typeof render>): HTMLElement {
  const screen = view.container.querySelector<HTMLElement>(
    ".explorer-blob-browser-screen",
  );
  if (!screen) {
    throw new Error("Expected the blob list screen.");
  }
  return screen;
}

test("the toolbar switch cycles the blob list through small rows, large rows, and grid", async () => {
  const { view } = await renderBlobBrowser();

  // The checkbox the switch replaces is gone.
  expect(view.queryByRole("checkbox")).toBeNull();
  expect(screenOf(view).getAttribute("data-item-view")).toBe("rows");

  // Each click moves to the view the button named, and stores it.
  fireEvent.click(
    view.getByRole("button", {
      name: BLOB_LIST_LABELS.itemViewSwitchToLargeRows,
    }),
  );
  expect(localStorage.getItem(STORAGE_KEY)).toBe("large-rows");
  expect(screenOf(view).getAttribute("data-item-view")).toBe("large-rows");
  const table = view.getByRole("table", { name: BLOB_LIST_LABELS.title });
  expect(
    table
      .closest<HTMLElement>(".explorer-blob-browser-table-wrap")
      ?.style.getPropertyValue("--mini-app-virtual-row-height"),
  ).toBe("96px");

  fireEvent.click(
    view.getByRole("button", { name: BLOB_LIST_LABELS.itemViewSwitchToGrid }),
  );
  await act(async () => undefined);
  expect(localStorage.getItem(STORAGE_KEY)).toBe("grid");
  expect(view.queryByRole("table")).toBeNull();
  const grid = view.getByRole("list", { name: BLOB_LIST_LABELS.title });
  expect(grid.children).toHaveLength(2);
  // The grid keeps sorting in its pinned header.
  expect(
    view.getByRole("combobox", {
      name: new RegExp(`^${BLOB_LIST_LABELS.sortMenuLabel}: `),
    }),
  ).toBeTruthy();

  fireEvent.click(
    view.getByRole("button", { name: BLOB_LIST_LABELS.itemViewSwitchToRows }),
  );
  await act(async () => undefined);
  expect(localStorage.getItem(STORAGE_KEY)).toBe("rows");
  expect(
    view.getByRole("table", { name: BLOB_LIST_LABELS.title }),
  ).toBeTruthy();
});

test("the grid fetches whole lines of the tiles its measured frame fits", async () => {
  // A 390px frame fits three tiles across.
  mockFrameWidth(390);
  localStorage.setItem(STORAGE_KEY, "grid");
  const { requests } = await renderBlobBrowser();

  // The window's minimum of 24 lines, three blobs each.
  expect(requests.at(-1)).toEqual({ limit: 72, offset: 0 });
});

test("a grid tile opens the blob, and the open blob takes the switch off the toolbar", async () => {
  localStorage.setItem(STORAGE_KEY, "grid");
  const { view } = await renderBlobBrowser();

  fireEvent.click(view.getByRole("button", { name: "file-2" }));

  expect(await view.findByText("Blob Metadata")).toBeTruthy();
  expect(
    view.queryByRole("button", { name: BLOB_LIST_LABELS.itemViewSwitchToRows }),
  ).toBeNull();
});

test("a pick in the grid takes an image tile and disables the rest", async () => {
  localStorage.setItem(STORAGE_KEY, "grid");
  const picked: Array<string | null> = [];
  const { view } = await renderBlobBrowser({
    onPickBlob: (blob) => picked.push(blob.blobId),
  });

  // The pick surface carries the same switch.
  expect(
    view.getByRole("button", { name: BLOB_LIST_LABELS.itemViewSwitchToRows }),
  ).toBeTruthy();

  const textTile = view.getByRole("button", { name: "file-1" });
  expect((textTile as HTMLButtonElement).disabled).toBe(true);
  // The hint rides on a wrapper, since a disabled button may not show a title.
  expect(textTile.parentElement?.getAttribute("title")).toBe(
    BLOB_LIST_LABELS.pickUnavailableHint,
  );
  fireEvent.click(textTile);
  expect(picked).toEqual([]);

  fireEvent.click(view.getByRole("button", { name: "file-2" }));
  expect(picked).toEqual(["blob-2"]);
});
