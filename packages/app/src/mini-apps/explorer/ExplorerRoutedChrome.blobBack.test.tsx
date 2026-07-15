import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  useWindowBackActionValue,
  WindowMenuProvider,
} from "../../components/window/WindowMenuContext";
import type { AppNavigationMode } from "../../navigation/AppNavigationMode";
import { useExplorerRoutedChromeActions } from "./ExplorerRoutedChrome";
import type { useExplorerModel } from "./hooks/useExplorerModel";
import { EXPLORER_LABELS } from "./labels";
import type { ExplorerRoute } from "./routes";

type ExplorerModel = ReturnType<typeof useExplorerModel>;

afterEach(cleanup);

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
  historyCanGoBack = false,
  mode,
  model,
}: {
  historyCanGoBack?: boolean;
  mode: AppNavigationMode;
  model: ExplorerModel;
}) {
  useExplorerRoutedChromeActions({
    historyCanGoBack,
    model,
    navigationMode: mode,
    openStructuredDocumentGrid: () => undefined,
    triggerUpload: () => undefined,
  });
  return <BackProbe />;
}

test("windowed blob browser Back returns to its navigation origin", async () => {
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
      <BlobBackHarness mode="windowed" model={model} />
    </WindowMenuProvider>,
  );

  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.blobBrowserBackAction,
    }),
  );
  expect(navigatedBack).toEqual([1]);
});

test("routed blob browser leaves Back to app history", async () => {
  const model = createBlobRouteModel({
    blobId: "front-blob",
    storageKey: null,
    view: "blob-browser",
  });
  const view = render(
    <WindowMenuProvider>
      <BlobBackHarness historyCanGoBack mode="routed" model={model} />
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

test("routed direct blob link gets a Back fallback", async () => {
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
      <BlobBackHarness mode="routed" model={model} />
    </WindowMenuProvider>,
  );

  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.blobBrowserBackAction,
    }),
  );
  expect(navigatedBack).toEqual([1]);
});
