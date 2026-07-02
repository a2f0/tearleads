import { afterEach, expect, test } from "bun:test";
import type { BlobBytes, BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { createDomainScope } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ExplorerBlobPickTarget } from "../blob-pick/ExplorerBlobPickProvider";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";

afterEach(cleanup);

function createBlobRows(): BlobInfo[] {
  return Array.from({ length: 2 }, (_, index) => {
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
      updatedAt: `2026-05-17T00:0${index}:00.000Z`,
    };
  });
}

function createBlobStore(overrides: Partial<BlobStore> = {}): BlobStore {
  return {
    deleteBytes: async () => undefined,
    readBytes: async () => null,
    writeBytes: async () => undefined,
    ...overrides,
  };
}

function renderBrowsePanel(blobStore: BlobStore) {
  const rows = createBlobRows();
  return render(
    <ExplorerBlobBrowserPanel
      blobStore={blobStore}
      domainScope={createDomainScope()}
      loadBlobInfo={async () => ({ rows, totalCount: rows.length })}
      nodes={[]}
      online={true}
      onBackToSelectionRoute={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={{ blobId: null, storageKey: null, view: "blob-browser" }}
      selectDocumentProjection={() => undefined}
    />,
  );
}

async function openRowContextMenu(
  view: ReturnType<typeof render>,
  blobLabel: string,
) {
  const rowButton = await view.findByRole("button", { name: blobLabel });
  const row = rowButton.closest("tr");
  expect(row).not.toBeNull();
  fireEvent.contextMenu(row as HTMLTableRowElement);
}

test("right-click download saves a blob's local bytes", async () => {
  const bytes = new Uint8Array([1, 2, 3]) as BlobBytes;
  const readKeys: string[] = [];
  const blobStore = createBlobStore({
    readBytes: async (storageKey) => {
      readKeys.push(storageKey);
      return bytes;
    },
  });

  // downloadBytesAsFile drives an anchor click; capture the download name it
  // would hand to the browser without triggering a real navigation.
  const downloads: string[] = [];
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    downloads.push(this.download);
  };

  try {
    const view = renderBrowsePanel(blobStore);
    await openRowContextMenu(view, "blob-1");
    fireEvent.click(await view.findByText("Download"));

    await waitFor(() => expect(readKeys).toEqual(["storage-1"]));
    // A nameless blob falls back to its blob id for the download file name.
    expect(downloads).toEqual(["blob-1"]);
  } finally {
    HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("right-click download reports when local bytes are unavailable", async () => {
  const view = renderBrowsePanel(
    createBlobStore({ readBytes: async () => null }),
  );

  await openRowContextMenu(view, "blob-1");
  fireEvent.click(await view.findByText("Download"));

  await waitFor(() =>
    expect(view.getByText("Local bytes are unavailable.")).toBeTruthy(),
  );
});

test("changing the search query clears a stale download message", async () => {
  const view = renderBrowsePanel(
    createBlobStore({ readBytes: async () => null }),
  );

  await openRowContextMenu(view, "blob-1");
  fireEvent.click(await view.findByText("Download"));
  await waitFor(() =>
    expect(view.getByText("Local bytes are unavailable.")).toBeTruthy(),
  );

  fireEvent.change(
    view.getByLabelText("Search blobs, storage keys, documents, or slots"),
    { target: { value: "blob-2" } },
  );

  await waitFor(() =>
    expect(view.queryByText("Local bytes are unavailable.")).toBeNull(),
  );
});

test("right-click opens the menu without bubbling to the pane menu", async () => {
  // The blob browser renders inside a Pane whose own onContextMenu opens the
  // desktop menu; the row right-click must stop there so both do not appear.
  let ancestorContextMenus = 0;
  const rows = createBlobRows();
  const view = render(
    // Mirrors the real Pane: a role="application" section that opens the desktop
    // menu on right-click.
    <section
      aria-label="pane"
      onContextMenu={() => {
        ancestorContextMenus += 1;
      }}
      role="application"
    >
      <ExplorerBlobBrowserPanel
        blobStore={createBlobStore()}
        domainScope={createDomainScope()}
        loadBlobInfo={async () => ({ rows, totalCount: rows.length })}
        nodes={[]}
        online={true}
        onBackToSelectionRoute={() => undefined}
        openDocumentInfoRoute={() => undefined}
        route={{ blobId: null, storageKey: null, view: "blob-browser" }}
        selectDocumentProjection={() => undefined}
      />
    </section>,
  );

  await openRowContextMenu(view, "blob-1");

  expect(await view.findByText("Download")).toBeTruthy();
  expect(ancestorContextMenus).toBe(0);
});

const PICK_TARGET: ExplorerBlobPickTarget = {
  containerId: "container-1",
  localId: "local-document-1",
  slotId: "front-image",
  slotLabel: "Front Image",
};

test("pick mode does not offer a row download context menu", async () => {
  const rows = createBlobRows();
  const view = render(
    <ExplorerBlobBrowserPanel
      blobStore={createBlobStore()}
      domainScope={createDomainScope()}
      loadBlobInfo={async () => ({ rows, totalCount: rows.length })}
      nodes={[]}
      online={true}
      onBackToSelectionRoute={() => undefined}
      onCancelBlobPick={() => undefined}
      onPickBlob={() => undefined}
      openDocumentInfoRoute={() => undefined}
      pickTarget={PICK_TARGET}
      route={{ blobId: null, storageKey: null, view: "blob-browser" }}
      selectDocumentProjection={() => undefined}
    />,
  );

  await openRowContextMenu(view, "blob-2");
  expect(view.queryByText("Download")).toBeNull();
});
