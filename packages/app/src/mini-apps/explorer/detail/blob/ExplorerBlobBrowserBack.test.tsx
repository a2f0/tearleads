import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  useWindowBackActionValue,
  WindowMenuProvider,
} from "../../../../components/window/WindowMenuContext";
import { ExplorerBlobBrowserPanel } from "./ExplorerBlobBrowserPanel";

const BLOB: BlobInfo = {
  blobId: "blob-1",
  byteLength: 1,
  createdAt: null,
  documentCount: 1,
  key: "blob:blob-1",
  mimeType: "image/png",
  name: "front.png",
  organizationId: null,
  referenceCount: 0,
  references: [],
  storageKey: "front-storage-key",
  updatedAt: "2026-05-17T00:00:00.000Z",
};

afterEach(cleanup);

function createBlobStore(): BlobStore {
  return {
    deleteBytes: async () => undefined,
    openByteSource: async () => null,
    readBytes: async () => null,
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
  };
}

function BackActionProbe() {
  const backAction = useWindowBackActionValue();
  return (
    <div aria-label="Toolbar" role="toolbar">
      {backAction ? (
        <button
          aria-label={backAction.label}
          disabled={backAction.disabled}
          type="button"
          onClick={backAction.onClick}
        />
      ) : null}
    </div>
  );
}

function renderBlobBrowser(route: {
  blobId: string | null;
  storageKey: string | null;
}) {
  return render(
    <WindowMenuProvider>
      <ExplorerBlobBrowserPanel
        blobStore={createBlobStore()}
        loadBlobInfo={async () => ({ rows: [BLOB], totalCount: 1 })}
        nodes={[]}
        online={true}
        onCancelBlobPick={() => undefined}
        openDocumentInfoRoute={() => undefined}
        route={route}
        selectDocumentProjection={() => undefined}
      />
      <BackActionProbe />
    </WindowMenuProvider>,
  );
}

test("list drill-in uses the shared toolbar Back action", async () => {
  const view = renderBlobBrowser({ blobId: null, storageKey: null });
  fireEvent.click(await view.findByRole("button", { name: "blob-1" }));

  await waitFor(() => {
    expect(view.getByText("Blob Metadata")).toBeTruthy();
  });
  expect(view.queryByRole("button", { name: "Back to List" })).toBeNull();

  const toolbar = view.getByRole("toolbar", { name: "Toolbar" });
  fireEvent.click(within(toolbar).getByRole("button", { name: "Back" }));

  await waitFor(() => {
    expect(
      view.container.querySelector(".explorer-blob-browser-table-wrap"),
    ).toBeTruthy();
  });
  expect(view.queryByText("Blob Metadata")).toBeNull();
});

test("route-selected detail leaves Back to route navigation", async () => {
  const view = renderBlobBrowser({
    blobId: null,
    storageKey: "front-storage-key",
  });

  await waitFor(() => {
    expect(view.getByText("Blob Metadata")).toBeTruthy();
  });

  // A route-selected blob must not override app-history Back; doing so would
  // lose the driver's-license origin and browser Forward entry.
  expect(view.queryByRole("button", { name: "Back to List" })).toBeNull();
  expect(
    within(view.getByRole("toolbar", { name: "Toolbar" })).queryByRole(
      "button",
      { name: "Back" },
    ),
  ).toBeNull();
});
