import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobStore } from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  useWindowBackActionValue,
  WindowMenuProvider,
} from "../../components/window/WindowMenuContext";
import { ExplorerBlobBrowserPanel } from "./detail/blob/ExplorerBlobBrowserPanel";
import { useExplorerRoutedChromeActions } from "./ExplorerRoutedChrome";
import type { useExplorerModel } from "./hooks/useExplorerModel";
import { EXPLORER_LABELS } from "./labels";
import type { ExplorerRoute } from "./routes";

type ExplorerModel = ReturnType<typeof useExplorerModel>;

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

function createBlobRouteModel(
  route: ExplorerRoute,
  navigateBackFromBlobBrowser: () => void = () => undefined,
): ExplorerModel {
  return {
    canCreateChildInActiveContainer: false,
    canCreateContactInActiveContainer: false,
    canCreateStructuredDocumentInActiveContainer: false,
    canLinkSelectedDocument: false,
    canMoveSelectedDocument: false,
    canUploadToActiveContainer: false,
    explorer: { ready: true },
    isActiveContactsContainer: false,
    modalState: {
      openCreateChildModal: () => undefined,
      openLinkDocumentModal: () => undefined,
      openMoveDocumentModal: () => undefined,
    },
    openInlineDocument: () => undefined,
    routeState: {
      navigateBackFromBlobBrowser,
      openBlobBrowserRoute: () => undefined,
      openContainerInfoRoute: () => undefined,
      openDocumentInfoRoute: () => undefined,
      openSyncLanesRoute: () => undefined,
      openWriteQueueRoute: () => undefined,
      route,
      showSelectionRoute: () => undefined,
    },
    selectDocumentProjection: () => undefined,
    selection: {
      activeContainerId: null,
      selectedDocument: undefined,
    },
  } as unknown as ExplorerModel;
}

function BackProbe() {
  const action = useWindowBackActionValue();
  return action ? (
    <button type="button" aria-label={action.label} onClick={action.onClick} />
  ) : null;
}

function BlobBackHarness({
  children,
  historyCanGoBack = false,
  model,
}: {
  children?: ReactNode;
  historyCanGoBack?: boolean;
  model: ExplorerModel;
}) {
  useExplorerRoutedChromeActions({
    historyCanGoBack,
    model,
    openStructuredDocumentGrid: () => undefined,
    triggerUpload: () => undefined,
  });
  return (
    <>
      {children}
      <BackProbe />
    </>
  );
}

test("blob browser Back returns to its navigation origin with no history", async () => {
  const navigatedBack: number[] = [];
  const model = createBlobRouteModel(
    {
      blobId: null,
      storageKey: "front-storage-key",
      view: "blob-browser",
    },
    () => navigatedBack.push(1),
  );
  const view = render(
    <WindowMenuProvider>
      <BlobBackHarness model={model} />
    </WindowMenuProvider>,
  );

  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.blobBrowserBackAction,
    }),
  );
  expect(navigatedBack).toEqual([1]);
});

test("list drill-in returns to the list before its navigation origin", async () => {
  const navigatedBack: number[] = [];
  const model = createBlobRouteModel(
    {
      blobId: null,
      storageKey: null,
      view: "blob-browser",
    },
    () => navigatedBack.push(1),
  );
  const view = render(
    <WindowMenuProvider>
      <BlobBackHarness model={model}>
        <ExplorerBlobBrowserPanel
          blobStore={createBlobStore()}
          loadBlobInfo={async () => ({ rows: [BLOB], totalCount: 1 })}
          nodes={[]}
          onCancelBlobPick={() => undefined}
          online={true}
          openDocumentInfoRoute={() => undefined}
          route={{ blobId: null, storageKey: null }}
          selectDocumentProjection={() => undefined}
        />
      </BlobBackHarness>
    </WindowMenuProvider>,
  );

  fireEvent.click(await view.findByRole("button", { name: "blob-1" }));
  await waitFor(() => {
    expect(view.getByText("Blob Metadata")).toBeTruthy();
  });

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.blobBrowserBackAction,
    }),
  );

  await waitFor(() => {
    expect(
      view.container.querySelector(".explorer-blob-browser-table-wrap"),
    ).toBeTruthy();
  });
  expect(view.queryByText("Blob Metadata")).toBeNull();
  expect(navigatedBack).toEqual([]);

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.blobBrowserBackAction,
    }),
  );
  expect(navigatedBack).toEqual([1]);
});

test("blob browser leaves Back to host history when there is history", async () => {
  const model = createBlobRouteModel({
    blobId: "front-blob",
    storageKey: null,
    view: "blob-browser",
  });
  const view = render(
    <WindowMenuProvider>
      <BlobBackHarness historyCanGoBack model={model} />
    </WindowMenuProvider>,
  );

  await waitFor(() => {
    expect(
      view.queryByRole("button", {
        name: EXPLORER_LABELS.blobBrowserBackAction,
      }),
    ).toBeNull();
  });
});

test("direct blob link with no history gets a Back fallback", async () => {
  const navigatedBack: number[] = [];
  const model = createBlobRouteModel(
    {
      blobId: "front-blob",
      storageKey: null,
      view: "blob-browser",
    },
    () => navigatedBack.push(1),
  );
  const view = render(
    <WindowMenuProvider>
      <BlobBackHarness model={model} />
    </WindowMenuProvider>,
  );

  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.blobBrowserBackAction,
    }),
  );
  expect(navigatedBack).toEqual([1]);
});
