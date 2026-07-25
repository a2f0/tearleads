import {
  useWindowBackActionValue,
  useWindowTitleBarActions,
} from "../../components/window/WindowMenuContext";
import type { AppNavigationMode } from "../../navigation/AppNavigationMode";
import { useExplorerRoutedChromeActions } from "./ExplorerRoutedChrome";
import type { useExplorerModel } from "./hooks/useExplorerModel";

export type ExplorerModel = ReturnType<typeof useExplorerModel>;

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
      openContainerInfoRoute: () => undefined,
      openDocumentInfoRoute: () => undefined,
      openSyncLanesRoute: () => undefined,
      openWriteQueueRoute: () => undefined,
      route: { view: "selection" },
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
  navigationMode = "windowed",
  openStructuredDocumentGrid = noopOpenStructuredDocumentGrid,
  triggerUpload = noopTriggerUpload,
}: {
  historyCanGoBack?: boolean;
  model: ExplorerModel;
  navigationMode?: AppNavigationMode;
  openStructuredDocumentGrid?: () => void;
  triggerUpload?: (containerId: string) => void;
}) {
  useExplorerRoutedChromeActions({
    historyCanGoBack,
    model,
    navigationMode,
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
