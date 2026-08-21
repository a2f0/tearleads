import { afterEach, expect, test } from "bun:test";
import type { BlobBytes, BlobInfo, BlobStore } from "@symcrypt/client-sdk";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../../../components/window/WindowMenuContext";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";

afterEach(cleanup);

function createBlobRow(input: {
  blobId: string;
  mimeType: string;
  name?: string | null | undefined;
  storageKey: string;
}): BlobInfo {
  return {
    blobId: input.blobId,
    byteLength: 3,
    createdAt: null,
    documentCount: 1,
    key: `blob:${input.blobId}`,
    mimeType: input.mimeType,
    name: input.name ?? null,
    organizationId: null,
    referenceCount: 0,
    references: [],
    storageKey: input.storageKey,
    updatedAt: "2026-05-17T00:00:00.000Z",
  };
}

const IMAGE_BLOB = createBlobRow({
  blobId: "blob-image",
  mimeType: "image/png",
  name: "photo.png",
  storageKey: "storage-image",
});

const TEXT_BLOB = createBlobRow({
  blobId: "blob-text",
  mimeType: "text/plain",
  name: "notes.txt",
  storageKey: "storage-text",
});

const VIDEO_BLOB = createBlobRow({
  blobId: "blob-video",
  mimeType: "video/mp4",
  name: "clip.mp4",
  storageKey: "storage-video",
});

function createBlobStore(overrides: Partial<BlobStore> = {}): BlobStore {
  return {
    deleteBytes: async () => undefined,
    openByteSource: async () => null,
    readBytes: async () => new Uint8Array([1, 2, 3]) as BlobBytes,
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
    ...overrides,
  };
}

// The toolbar actions the panel registers are rendered by the window chrome (or
// the routed app bar), neither of which is mounted here; this probe stands in
// for them the same way the real chrome does.
function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={action.label}
          disabled={action.disabled}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

function renderBlobBrowser(input: {
  blobStore?: BlobStore | undefined;
  rows?: ReadonlyArray<BlobInfo> | undefined;
  selectedBlobId?: string | null | undefined;
}) {
  const rows = input.rows ?? [IMAGE_BLOB, TEXT_BLOB, VIDEO_BLOB];

  return render(
    <WindowMenuProvider>
      <ExplorerBlobBrowserPanel
        blobStore={input.blobStore ?? createBlobStore()}
        loadBlobInfo={async () => ({ rows, totalCount: rows.length })}
        nodes={[]}
        online={true}
        onCancelBlobPick={() => undefined}
        openDocumentInfoRoute={() => undefined}
        route={{
          blobId: input.selectedBlobId ?? null,
          storageKey: null,
        }}
        selectDocumentProjection={() => undefined}
      />
      <ToolbarProbe />
    </WindowMenuProvider>,
  );
}

test("the blob list registers no detail actions until a blob is open", async () => {
  const view = renderBlobBrowser({});

  // Rows are labelled by blob id; the list itself carries no detail chrome.
  await view.findByRole("button", { name: "blob-image" });
  expect(view.queryByRole("button", { name: "Open" })).toBeNull();
  expect(view.queryByRole("button", { name: "Download" })).toBeNull();
});

test("blob detail puts Open and Download on the toolbar", async () => {
  const view = renderBlobBrowser({ selectedBlobId: IMAGE_BLOB.blobId });

  const open = await view.findByRole("button", { name: "Open" });
  const download = view.getByRole("button", { name: "Download" });
  // Open comes first: it is the primary action on a blob you are looking at.
  expect(
    open.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
});

test("toolbar Download saves the blob's local bytes", async () => {
  const readKeys: string[] = [];
  const blobStore = createBlobStore({
    readBytes: async (storageKey) => {
      readKeys.push(storageKey);
      return new Uint8Array([1, 2, 3]) as BlobBytes;
    },
  });
  const downloads: string[] = [];
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    downloads.push(this.download);
  };

  try {
    const view = renderBlobBrowser({
      blobStore,
      selectedBlobId: IMAGE_BLOB.blobId,
    });

    fireEvent.click(await view.findByRole("button", { name: "Download" }));

    await waitFor(() => expect(downloads).toEqual(["photo.png"]));
    expect(readKeys).toContain("storage-image");
  } finally {
    HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("Open cannot fire while the blob has no local bytes to show", async () => {
  const view = renderBlobBrowser({
    blobStore: createBlobStore({ readBytes: async () => null }),
    selectedBlobId: IMAGE_BLOB.blobId,
  });

  await view.findByText("Local bytes are unavailable.");
  expect(
    (view.getByRole("button", { name: "Open" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  // Download still reads through to the store, which reports the miss itself.
  expect(
    (view.getByRole("button", { name: "Download" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

test("Open shows an image in the full-screen viewer and Close dismisses it", async () => {
  const view = renderBlobBrowser({ selectedBlobId: IMAGE_BLOB.blobId });
  const open = await view.findByRole("button", { name: "Open" });
  await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));

  fireEvent.click(open);

  const viewer = await view.findByRole("dialog");
  const viewerImage = within(viewer).getByAltText("photo.png");
  expect(viewerImage.getAttribute("src")?.startsWith("blob:")).toBe(true);
  // The viewer is the image alone — the detail screen's metadata stays behind it
  // rather than coming along.
  expect(viewer.textContent?.includes("Blob Metadata")).toBe(false);

  fireEvent.click(within(viewer).getByRole("button", { name: "Close" }));
  expect(view.queryByRole("dialog")).toBeNull();
});

test("the inline image preview is itself a way into the viewer", async () => {
  const view = renderBlobBrowser({ selectedBlobId: IMAGE_BLOB.blobId });

  fireEvent.click(
    await view.findByRole("button", { name: "Open full screen" }),
  );

  const viewer = await view.findByRole("dialog");
  expect(
    within(viewer)
      .getByAltText("photo.png")
      .getAttribute("src")
      ?.startsWith("blob:"),
  ).toBe(true);
});

// Video and audio own their own tap — play/pause, scrub — and the viewer has
// nothing to show for them either way, so only an image becomes a button.
test("a playable media preview is left alone", async () => {
  const view = renderBlobBrowser({ selectedBlobId: VIDEO_BLOB.blobId });

  await view.findByRole("button", { name: "Download" });
  expect(view.queryByRole("button", { name: "Open full screen" })).toBeNull();
});

test("a non-image blob still opens in a new tab", async () => {
  const opened: string[] = [];
  const originalOpen = window.open;
  window.open = ((url?: string | URL) => {
    opened.push(String(url));
    return null;
  }) as typeof window.open;

  try {
    const view = renderBlobBrowser({ selectedBlobId: TEXT_BLOB.blobId });
    const open = await view.findByRole("button", { name: "Open" });
    await waitFor(() =>
      expect((open as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(open);

    expect(opened).toHaveLength(1);
    expect(opened[0]?.startsWith("blob:")).toBe(true);
    // No in-app viewer for a text blob.
    expect(view.queryByRole("dialog")).toBeNull();
  } finally {
    window.open = originalOpen;
  }
});
