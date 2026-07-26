import {
  useWindowBackActionValue,
  useWindowTitleBarActions,
} from "../../src/components/window/WindowMenuContext";
import { useExplorerRoutedChromeActions } from "../../src/mini-apps/explorer/ExplorerRoutedChrome";
import type { useExplorerModel } from "../../src/mini-apps/explorer/hooks/useExplorerModel";

type ExplorerModel = ReturnType<typeof useExplorerModel>;

export function createExplorerModel(
  overrides: Partial<ExplorerModel> = {},
): ExplorerModel {
  return {
    activeContainerHasRules: false,
    canCreateChildInActiveContainer: true,
    canCreateContactInActiveContainer: true,
    canCreateStructuredDocumentInActiveContainer: true,
    canUploadToActiveContainer: true,
    canLinkSelectedDocument: true,
    canMoveSelectedDocument: true,
    explorer: { ready: true },
    isActiveContactsContainer: true,
    modalState: {
      openCreateChildModal: () => undefined,
      openLinkDocumentModal: () => undefined,
      openMoveDocumentModal: () => undefined,
    },
    openInlineDocument: () => undefined,
    routeState: {
      navigateBackFromBlobBrowser: () => undefined,
      openBlobBrowserRoute: () => undefined,
      openContainerInfoRoute: () => undefined,
      openDocumentInfoRoute: () => undefined,
      openSyncLanesRoute: () => undefined,
      openWriteQueueRoute: () => undefined,
      route: { view: "selection" },
      selectExplorerDocument: () => undefined,
      selectExplorerItem: () => undefined,
      showSelectionRoute: () => undefined,
    },
    selectDocumentProjection: () => undefined,
    selection: {
      activeContainerId: "contacts-container",
      selectedDocument: undefined,
    },
    ...overrides,
  } as unknown as ExplorerModel;
}

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

function BackProbe() {
  const backAction = useWindowBackActionValue();

  if (!backAction) {
    return null;
  }

  return (
    <button
      aria-label={backAction.label}
      disabled={backAction.disabled}
      type="button"
      onClick={backAction.onClick}
    />
  );
}

const noopOpenStructuredDocumentGrid = () => undefined;
const noopTriggerUpload = () => undefined;

export function ExplorerRoutedChromeHarness({
  historyCanGoBack = false,
  model,
  openStructuredDocumentGrid = noopOpenStructuredDocumentGrid,
  triggerUpload = noopTriggerUpload,
}: {
  historyCanGoBack?: boolean;
  model: ExplorerModel;
  openStructuredDocumentGrid?: () => void;
  triggerUpload?: (containerId: string) => void;
}) {
  useExplorerRoutedChromeActions({
    historyCanGoBack,
    model,
    openStructuredDocumentGrid,
    triggerUpload,
  });

  return (
    <>
      <ToolbarProbe />
      <BackProbe />
    </>
  );
}
