import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { ArrowsOutCardinalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutCardinal";
import { FilePlusIcon } from "@phosphor-icons/react/dist/csr/FilePlus";
import { FolderPlusIcon } from "@phosphor-icons/react/dist/csr/FolderPlus";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { useMemo } from "react";
import { useMiniAppDetailBackAction } from "../../components/window/useMiniAppDetailBackAction";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
import type { AppNavigationMode } from "../../navigation/AppNavigationMode";
import { useExplorerHubToolbarActions } from "./ExplorerHubToolbarActions";
import { getExplorerContainerToolbarVisibility } from "./explorerContainerToolbarVisibility";
import type { useExplorerModel } from "./hooks/useExplorerModel";
import { EXPLORER_LABELS } from "./labels";

type ExplorerModel = ReturnType<typeof useExplorerModel>;

export function useExplorerRoutedChromeActions({
  historyCanGoBack,
  model,
  navigationMode,
  openStructuredDocumentGrid,
  triggerUpload,
}: {
  historyCanGoBack: boolean;
  model: ExplorerModel;
  navigationMode: AppNavigationMode;
  openStructuredDocumentGrid: () => void;
  triggerUpload: (containerId: string) => void;
}) {
  const route = model.routeState.route;
  const activeContainerId = model.selection.activeContainerId;
  const selectedDocument = model.selection.selectedDocument;
  // Selecting a document row synchronously routes to "document-selection" but
  // selectedDocument stays undefined until its summary async-loads into
  // documentSummaries. During that gap the route already carries the ids, so
  // source them from it — otherwise the document toolbar registers no actions
  // (see showDocumentToolbar) and the bar goes empty mid-selection.
  const selectedDocumentId =
    selectedDocument?.id ??
    (route.view === "document-selection" ? route.localId : null);
  const selectedDocumentContainerId =
    selectedDocument?.containerId ??
    (route.view === "document-selection" ? route.containerId : null);
  const showContainerToolbar =
    route.view === "selection" &&
    activeContainerId !== null &&
    selectedDocument === undefined;
  const showContactsContainerToolbar =
    showContainerToolbar && model.isActiveContactsContainer;
  const showStandardContainerToolbar =
    showContainerToolbar && !model.isActiveContactsContainer;
  const containerToolbarVisibility = getExplorerContainerToolbarVisibility({
    activeContainerHasRules: model.activeContainerHasRules,
    canCreateChild: model.canCreateChildInActiveContainer,
    canCreateContact: model.canCreateContactInActiveContainer,
    canCreateDocument: model.canCreateStructuredDocumentInActiveContainer,
    canUpload: model.canUploadToActiveContainer,
    showContactsToolbar: showContactsContainerToolbar,
    showStandardToolbar: showStandardContainerToolbar,
  });
  // A selected document shows its toolbar (Get Info, plus link/move once their
  // targets load) — including the pending window before its summary loads, so the
  // bar never empties between a container selection and the document resolving.
  const showDocumentToolbar =
    (selectedDocument !== undefined || route.view === "document-selection") &&
    route.view !== "document-info";

  useExplorerRoutedBackAction({
    historyCanGoBack,
    model,
    navigationMode,
    route,
  });
  useExplorerHubToolbarActions({ model, route });
  useExplorerCreateFolderToolbarAction({
    activeContainerId,
    model,
    show: containerToolbarVisibility.createChild,
  });
  useExplorerUploadToolbarAction({
    activeContainerId,
    model,
    show: containerToolbarVisibility.upload,
    triggerUpload,
  });
  useExplorerNewDocumentToolbarAction({
    model,
    openStructuredDocumentGrid,
    show: containerToolbarVisibility.createDocument,
  });
  useExplorerNewContactToolbarAction({
    activeContainerId,
    model,
    show: containerToolbarVisibility.createContact,
  });
  useExplorerContainerInfoToolbarAction({
    activeContainerId,
    model,
    show: showContainerToolbar,
  });
  useExplorerDocumentInfoToolbarAction({
    documentId: selectedDocumentId,
    containerId: selectedDocumentContainerId,
    model,
    show: showDocumentToolbar,
  });
  useExplorerLinkDocumentToolbarAction({
    documentId: selectedDocumentId,
    model,
    show: showDocumentToolbar,
  });
  useExplorerMoveDocumentToolbarAction({
    documentId: selectedDocumentId,
    model,
    show: showDocumentToolbar,
  });
}

function useExplorerNewContactToolbarAction({
  activeContainerId,
  model,
  show,
}: {
  activeContainerId: string | null;
  model: ExplorerModel;
  show: boolean;
}) {
  const newContactAction = useMemo(
    () =>
      show
        ? {
            disabled:
              !model.explorer.ready || !model.canCreateContactInActiveContainer,
            icon: <AddressBookIcon aria-hidden size={18} />,
            id: "explorer-new-contact",
            label: EXPLORER_LABELS.newContactAction,
            onClick: () => {
              if (activeContainerId) {
                model.openInlineDocument(activeContainerId, "contact");
              }
            },
            priority: 400,
          }
        : null,
    [
      activeContainerId,
      model.canCreateContactInActiveContainer,
      model.explorer.ready,
      model.openInlineDocument,
      show,
    ],
  );

  useWindowTitleBarAction(newContactAction);
}

function useExplorerRoutedBackAction({
  historyCanGoBack,
  model,
  navigationMode,
  route,
}: {
  historyCanGoBack: boolean;
  model: ExplorerModel;
  navigationMode: AppNavigationMode;
  route: ExplorerModel["routeState"]["route"];
}) {
  const backAction = useMemo(() => {
    if (route.view === "document-info") {
      return {
        label: EXPLORER_LABELS.documentInfoBackAction,
        onBack: () => {
          model.selectDocumentProjection(route.localId, route.containerId);
        },
      };
    }

    if (route.view === "sync-lane-detail") {
      return {
        label: EXPLORER_LABELS.syncLanesBackToListAction,
        onBack: model.routeState.openSyncLanesRoute,
      };
    }

    if (route.view === "write-queue-entry") {
      return {
        label: EXPLORER_LABELS.writeQueueBackToListAction,
        onBack: model.routeState.openWriteQueueRoute,
      };
    }

    if (
      route.view === "sync-lanes" ||
      route.view === "write-queue" ||
      route.view === "uploads"
    ) {
      return {
        label: EXPLORER_LABELS.syncLanesBackAction,
        onBack: model.routeState.showSelectionRoute,
      };
    }

    // Routed mobile/tablet chrome owns a real app-history Back action whenever
    // an origin exists; leaving that unoverridden returns an attachment-opened
    // blob to its source document and keeps Forward intact. Windowed routes and
    // initial routed deep links have no history entry, so use the origin/fallback
    // navigation maintained by useExplorerRoute instead.
    if (
      route.view === "blob-browser" &&
      (navigationMode === "windowed" || !historyCanGoBack)
    ) {
      return {
        label: EXPLORER_LABELS.blobBrowserBackAction,
        onBack: model.routeState.navigateBackFromBlobBrowser,
      };
    }

    // Container-info, new-structured-document, and open documents no longer
    // surface a "Back to Container" action; selecting a container in the
    // sidebar returns to it.
    return null;
  }, [
    historyCanGoBack,
    model.routeState.navigateBackFromBlobBrowser,
    model.routeState.openSyncLanesRoute,
    model.routeState.openWriteQueueRoute,
    model.routeState.showSelectionRoute,
    model.selectDocumentProjection,
    navigationMode,
    route,
  ]);

  useMiniAppDetailBackAction(backAction);
}

function useExplorerCreateFolderToolbarAction({
  activeContainerId,
  model,
  show,
}: {
  activeContainerId: string | null;
  model: ExplorerModel;
  show: boolean;
}) {
  const createFolderAction = useMemo(
    () =>
      show
        ? {
            disabled:
              !model.explorer.ready || !model.canCreateChildInActiveContainer,
            icon: <FolderPlusIcon aria-hidden size={18} />,
            id: "explorer-create-child-folder",
            label: EXPLORER_LABELS.createChildFolderAction,
            onClick: () => {
              if (activeContainerId) {
                model.modalState.openCreateChildModal(activeContainerId);
              }
            },
            priority: 200,
          }
        : null,
    [
      activeContainerId,
      model.canCreateChildInActiveContainer,
      model.explorer.ready,
      model.modalState.openCreateChildModal,
      show,
    ],
  );

  useWindowTitleBarAction(createFolderAction);
}

function useExplorerUploadToolbarAction({
  activeContainerId,
  model,
  show,
  triggerUpload,
}: {
  activeContainerId: string | null;
  model: ExplorerModel;
  show: boolean;
  triggerUpload: (containerId: string) => void;
}) {
  const uploadAction = useMemo(
    () =>
      show
        ? {
            disabled:
              !model.explorer.ready || !model.canUploadToActiveContainer,
            icon: <UploadSimpleIcon aria-hidden size={18} />,
            id: "explorer-upload",
            label: EXPLORER_LABELS.uploadAction,
            onClick: () => {
              if (activeContainerId) {
                triggerUpload(activeContainerId);
              }
            },
            priority: 300,
          }
        : null,
    [
      activeContainerId,
      model.canUploadToActiveContainer,
      model.explorer.ready,
      show,
      triggerUpload,
    ],
  );

  useWindowTitleBarAction(uploadAction);
}

function useExplorerNewDocumentToolbarAction({
  model,
  openStructuredDocumentGrid,
  show,
}: {
  model: ExplorerModel;
  openStructuredDocumentGrid: () => void;
  show: boolean;
}) {
  const newDocumentAction = useMemo(
    () =>
      show
        ? {
            disabled:
              !model.explorer.ready ||
              !model.canCreateStructuredDocumentInActiveContainer,
            icon: <FilePlusIcon aria-hidden size={18} />,
            id: "explorer-new-structured-document-toolbar",
            label: EXPLORER_LABELS.newStructuredDocumentAction,
            onClick: openStructuredDocumentGrid,
            priority: 400,
          }
        : null,
    [
      model.canCreateStructuredDocumentInActiveContainer,
      model.explorer.ready,
      openStructuredDocumentGrid,
      show,
    ],
  );

  useWindowTitleBarAction(newDocumentAction);
}

function useExplorerContainerInfoToolbarAction({
  activeContainerId,
  model,
  show,
}: {
  activeContainerId: string | null;
  model: ExplorerModel;
  show: boolean;
}) {
  const containerInfoAction = useMemo(
    () =>
      show
        ? {
            disabled: !activeContainerId,
            icon: <InfoIcon aria-hidden size={18} />,
            id: "explorer-container-info",
            label: EXPLORER_LABELS.documentInfoGetInfoAction,
            onClick: () => {
              if (activeContainerId) {
                model.routeState.openContainerInfoRoute(activeContainerId);
              }
            },
            priority: 100,
          }
        : null,
    [activeContainerId, model.routeState.openContainerInfoRoute, show],
  );

  useWindowTitleBarAction(containerInfoAction);
}

function useExplorerDocumentInfoToolbarAction({
  containerId,
  documentId,
  model,
  show,
}: {
  containerId: string | null;
  documentId: string | null;
  model: ExplorerModel;
  show: boolean;
}) {
  const documentInfoAction = useMemo(
    () =>
      show
        ? {
            disabled: !containerId || !documentId,
            icon: <InfoIcon aria-hidden size={18} />,
            id: "explorer-document-info",
            label: EXPLORER_LABELS.documentInfoGetInfoAction,
            onClick: () => {
              if (containerId && documentId) {
                model.routeState.openDocumentInfoRoute(documentId, containerId);
              }
            },
            placement: "penultimate" as const,
            priority: 300,
          }
        : null,
    [containerId, documentId, model.routeState.openDocumentInfoRoute, show],
  );

  useWindowTitleBarAction(documentInfoAction);
}

function useExplorerLinkDocumentToolbarAction({
  documentId,
  model,
  show,
}: {
  documentId: string | null;
  model: ExplorerModel;
  show: boolean;
}) {
  const linkDocumentAction = useMemo(() => {
    // Hide the action when it is not performable rather than showing it greyed:
    // "if you can't do it, you can't see it." canLinkSelectedDocument already
    // requires at least one link target, and is false until the note syncs (Link
    // is remote-only), so a brand-new note simply omits Link.
    if (!show || !documentId || !model.canLinkSelectedDocument) {
      return null;
    }

    return {
      icon: <LinkSimpleIcon aria-hidden size={18} />,
      id: "explorer-link-document",
      label: EXPLORER_LABELS.documentLinkAction,
      onClick: () => {
        model.modalState.openLinkDocumentModal(documentId);
      },
      priority: 200,
    };
  }, [
    documentId,
    model.canLinkSelectedDocument,
    model.modalState.openLinkDocumentModal,
    show,
  ]);

  useWindowTitleBarAction(linkDocumentAction);
}

function useExplorerMoveDocumentToolbarAction({
  documentId,
  model,
  show,
}: {
  documentId: string | null;
  model: ExplorerModel;
  show: boolean;
}) {
  const moveDocumentAction = useMemo(() => {
    // Hide the action when it is not performable rather than showing it greyed:
    // "if you can't do it, you can't see it." canMoveSelectedDocument already
    // requires at least one move target. Move only relocates the local
    // containerId, so it stays available (visible) for offline / unsynced notes.
    if (!show || !documentId || !model.canMoveSelectedDocument) {
      return null;
    }

    return {
      icon: <ArrowsOutCardinalIcon aria-hidden size={18} />,
      id: "explorer-move-document",
      label: EXPLORER_LABELS.documentMoveAction,
      onClick: () => {
        model.modalState.openMoveDocumentModal(documentId);
      },
      priority: 110,
    };
  }, [
    documentId,
    model.canMoveSelectedDocument,
    model.modalState.openMoveDocumentModal,
    show,
  ]);

  useWindowTitleBarAction(moveDocumentAction);
}
