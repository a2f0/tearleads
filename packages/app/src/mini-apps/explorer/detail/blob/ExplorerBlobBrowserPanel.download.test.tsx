import { afterEach, expect, test } from "bun:test";
import type { BlobBytes, BlobInfo, BlobStore } from "@symcrypt/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { BlobPickTarget } from "../../../shared/blob-pick/BlobPickProvider";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";

afterEach(cleanup);

function createBlobRow(input: {
  blobId: string;
  byteLength?: number | undefined;
  mimeType: string;
  name?: string | null | undefined;
  storageKey: string;
  updatedAt?: string | null | undefined;
}): BlobInfo {
  return {
    blobId: input.blobId,
    byteLength: input.byteLength ?? 1,
    createdAt: null,
    documentCount: 1,
    key: `blob:${input.blobId}`,
    mimeType: input.mimeType,
    name: input.name ?? null,
    organizationId: null,
    referenceCount: 0,
    references: [],
    storageKey: input.storageKey,
    updatedAt: input.updatedAt ?? null,
  };
}

function createBlobRows(): BlobInfo[] {
  return Array.from({ length: 2 }, (_, index) =>
    createBlobRow({
      blobId: `blob-${index + 1}`,
      byteLength: index + 1,
      mimeType: (index + 1) % 2 === 0 ? "image/png" : "text/plain",
      storageKey: `storage-${index + 1}`,
      updatedAt: `2026-05-17T00:0${index}:00.000Z`,
    }),
  );
}

function createBlobStore(overrides: Partial<BlobStore> = {}): BlobStore {
  return {
    deleteBytes: async () => undefined,
    openByteSource: async () => null,
    readBytes: async () => null,
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
    ...overrides,
  };
}

function renderBrowsePanel(blobStore: BlobStore) {
  const rows = createBlobRows();
  return renderBlobBrowserPanel({
    blobStore,
    rows,
    route: { blobId: null, storageKey: null, view: "blob-browser" },
  });
}

function renderBlobBrowserPanel(input: {
  blobStore: BlobStore;
  rows: ReadonlyArray<BlobInfo>;
  route: {
    blobId: string | null;
    storageKey: string | null;
    view: "blob-browser";
  };
}) {
  return render(
    <ExplorerBlobBrowserPanel
      blobStore={input.blobStore}
      loadBlobInfo={async () => ({
        rows: input.rows,
        totalCount: input.rows.length,
      })}
      nodes={[]}
      online={true}
      onCancelBlobPick={() => undefined}
      openDocumentInfoRoute={() => undefined}
      route={input.route}
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

    // Image rows also read their bytes to build a thumbnail, so assert the
    // download read is present rather than that it is the only read.
    await waitFor(() => expect(readKeys).toContain("storage-1"));
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

test("a download resolving after a query change shows no stale message", async () => {
  // Hold the read open so it resolves only after the user has moved on.
  let resolveRead: ((value: BlobBytes | null) => void) | null = null;
  const blobStore = createBlobStore({
    readBytes: () =>
      new Promise<BlobBytes | null>((resolve) => {
        resolveRead = resolve;
      }),
  });
  const view = renderBrowsePanel(blobStore);

  await openRowContextMenu(view, "blob-1");
  fireEvent.click(await view.findByText("Download"));

  // User searches away while the read is still pending.
  fireEvent.change(
    view.getByLabelText("Search blobs, storage keys, documents, or slots"),
    { target: { value: "blob-2" } },
  );

  // The read now fails; its result belongs to a superseded download and must
  // not resurface the "unavailable" message.
  await act(async () => {
    resolveRead?.(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(view.queryByText("Local bytes are unavailable.")).toBeNull();
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
        loadBlobInfo={async () => ({ rows, totalCount: rows.length })}
        nodes={[]}
        online={true}
        onCancelBlobPick={() => undefined}
        openDocumentInfoRoute={() => undefined}
        route={{ blobId: null, storageKey: null }}
        selectDocumentProjection={() => undefined}
      />
    </section>,
  );

  await openRowContextMenu(view, "blob-1");

  expect(await view.findByText("Download")).toBeTruthy();
  expect(ancestorContextMenus).toBe(0);
});

test("blob detail previews audio and video with shared playback controls", async () => {
  const rows = [
    createBlobRow({
      blobId: "blob-audio",
      mimeType: "audio/mpeg",
      name: "voice.mp3",
      storageKey: "storage-audio",
    }),
    createBlobRow({
      blobId: "blob-video",
      mimeType: "video/mp4",
      name: "clip.mp4",
      storageKey: "storage-video",
    }),
  ];
  const blobStore = createBlobStore({
    readBytes: async () => new Uint8Array([1, 2, 3]) as BlobBytes,
  });
  const audioView = renderBlobBrowserPanel({
    blobStore,
    rows,
    route: {
      blobId: "blob-audio",
      storageKey: null,
      view: "blob-browser",
    },
  });

  const audio = (await audioView.findByLabelText(
    "voice.mp3",
  )) as HTMLAudioElement;
  expect(audio.tagName).toBe("AUDIO");
  expect(audio.controls).toBe(true);
  expect(audio.classList.contains("media-preview--audio")).toBe(true);
  audioView.unmount();

  const videoView = renderBlobBrowserPanel({
    blobStore,
    rows,
    route: {
      blobId: "blob-video",
      storageKey: null,
      view: "blob-browser",
    },
  });
  const video = (await videoView.findByLabelText(
    "clip.mp4",
  )) as HTMLVideoElement;

  expect(video.tagName).toBe("VIDEO");
  expect(video.controls).toBe(true);
  expect(video.classList.contains("media-preview--video")).toBe(true);
});

// The blob detail screen's own Open/Download actions now live on the window
// toolbar; they are covered in ExplorerBlobBrowserToolbar.test.tsx, which mounts
// the chrome that renders them.

test("blob detail renders the preview above the metadata", async () => {
  const view = renderBlobBrowserPanel({
    blobStore: createBlobStore(),
    rows: createBlobRows(),
    route: { blobId: "blob-1", storageKey: null, view: "blob-browser" },
  });

  const preview = await view.findByText("Preview");
  const metadata = view.getByText("Blob Metadata");
  // Node.DOCUMENT_POSITION_FOLLOWING (4) means metadata comes after preview.
  expect(
    preview.compareDocumentPosition(metadata) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    metadata
      .closest("section")
      ?.querySelector("table")
      ?.classList.contains("mini-app-info-table--borderless"),
  ).toBe(true);
});

test("image rows show a thumbnail while other rows show a file icon", async () => {
  const bytes = new Uint8Array([1, 2, 3]) as BlobBytes;
  const view = renderBlobBrowserPanel({
    blobStore: createBlobStore({ readBytes: async () => bytes }),
    rows: createBlobRows(),
    route: { blobId: null, storageKey: null, view: "blob-browser" },
  });

  // blob-2 is image/png: its bytes load into an inline <img> thumbnail.
  await waitFor(() =>
    expect(
      view.container.querySelector("img.explorer-blob-browser-thumb-image"),
    ).not.toBeNull(),
  );
  // blob-1 is text/plain: no thumbnail, so a file-type icon stands in.
  expect(
    view.container.querySelector(".explorer-blob-browser-thumb-icon"),
  ).not.toBeNull();
});

test("large blobs skip automatic preview and thumbnail reads", async () => {
  const readKeys: string[] = [];
  const largeImage = createBlobRow({
    blobId: "blob-large",
    byteLength: 5 * 1024 * 1024 + 1,
    mimeType: "image/png",
    storageKey: "storage-large",
  });
  const view = renderBlobBrowserPanel({
    blobStore: createBlobStore({
      readBytes: async (storageKey) => {
        readKeys.push(storageKey);
        return new Uint8Array([1, 2, 3]) as BlobBytes;
      },
    }),
    rows: [largeImage],
    route: {
      blobId: largeImage.blobId,
      storageKey: null,
      view: "blob-browser",
    },
  });

  await view.findByText("No inline preview for this blob.");
  await act(async () => Promise.resolve());
  expect(readKeys).toEqual([]);
});

test("the blob id is hidden from the row but stays the button's label", async () => {
  const view = renderBrowsePanel(createBlobStore());

  // The compact id text is gone from the cell, but the row action button keeps
  // the full id as its accessible name (and cell tooltip).
  const button = await view.findByRole("button", { name: "blob-1" });
  expect(button.textContent).toBe("");
});

const PICK_TARGET: BlobPickTarget = {
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
      loadBlobInfo={async () => ({ rows, totalCount: rows.length })}
      nodes={[]}
      online={true}
      onCancelBlobPick={() => undefined}
      onPickBlob={() => undefined}
      openDocumentInfoRoute={() => undefined}
      pickTarget={PICK_TARGET}
      route={{ blobId: null, storageKey: null }}
      selectDocumentProjection={() => undefined}
    />,
  );

  await openRowContextMenu(view, "blob-2");
  expect(view.queryByText("Download")).toBeNull();
});
