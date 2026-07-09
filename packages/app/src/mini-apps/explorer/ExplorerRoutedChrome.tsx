import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { ArrowsOutCardinalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutCardinal";
import { FilePlusIcon } from "@phosphor-icons/react/dist/csr/FilePlus";
import { FolderPlusIcon } from "@phosphor-icons/react/dist/csr/FolderPlus";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { type ChangeEvent, useCallback, useMemo, useRef } from "react";
import {
  useWindowBackAction,
  useWindowTitleBarAction,
} from "../../components/window/WindowMenuContext";
import type { useExplorerModel } from "./hooks/useExplorerModel";
import { EXPLORER_LABELS } from "./labels";

type ExplorerModel = ReturnType<typeof useExplorerModel>;

export function useExplorerToolbarUpload(
  importDroppedFiles: ExplorerModel["importDroppedFiles"],
) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadContainerIdRef = useRef<string | null>(null);

  const triggerUpload = useCallback((containerId: string) => {
    uploadContainerIdRef.current = containerId;
    fileInputRef.current?.click();
  }, []);

  const handleUploadChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      const uploadContainerId = uploadContainerIdRef.current;
      try {
        if (files.length > 0 && uploadContainerId) {
          void importDroppedFiles(uploadContainerId, files).catch(() => {
            // The importer logs per-file failures; keep toolbar uploads from
            // surfacing exceptional rejections as unhandled.
          });
        }
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        uploadContainerIdRef.current = null;
      }
    },
    [importDroppedFiles],
  );

  return {
    input: (
      <input
        ref={fileInputRef}
        className="explorer-toolbar-file-input"
        style={{ display: "none" }}
        type="file"
        multiple
        onChange={handleUploadChange}
      />
    ),
    triggerUpload,
  };
}

export function useExplorerRoutedChromeActions({
  model,
  openStructuredDocumentGrid,
  triggerUpload,
}: {
  model: ExplorerModel;
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
  // A selected document shows its toolbar (Get Info, plus link/move once their
  // targets load) — including the pending window before its summary loads, so the
  // bar never empties between a container selection and the document resolving.
  const showDocumentToolbar =
    (selectedDocument !== undefined || route.view === "document-selection") &&
    route.view !== "document-info";

  useExplorerRoutedBackAction({
    model,
    route,
  });
  useExplorerCreateFolderToolbarAction({
    activeContainerId,
    model,
    show: showStandardContainerToolbar,
  });
  useExplorerUploadToolbarAction({
    activeContainerId,
    model,
    show: showStandardContainerToolbar,
    triggerUpload,
  });
  useExplorerNewDocumentToolbarAction({
    model,
    openStructuredDocumentGrid,
    show: showStandardContainerToolbar,
  });
  useExplorerNewContactToolbarAction({
    activeContainerId,
    model,
    show: showContactsContainerToolbar,
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
            priority: 100,
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
  model,
  route,
}: {
  model: ExplorerModel;
  route: ExplorerModel["routeState"]["route"];
}) {
  const backAction = useMemo(() => {
    if (route.view === "document-info") {
      return {
        label: EXPLORER_LABELS.documentInfoBackAction,
        onClick: () => {
          model.selectDocumentProjection(route.localId, route.containerId);
        },
        priority: 100,
      };
    }

    if (route.view === "sync-lane-detail") {
      return {
        label: EXPLORER_LABELS.syncLanesBackToListAction,
        onClick: model.routeState.openSyncLanesRoute,
        priority: 100,
      };
    }

    if (route.view === "sync-lanes") {
      return {
        label: EXPLORER_LABELS.syncLanesBackAction,
        onClick: model.routeState.showSelectionRoute,
        priority: 100,
      };
    }

    // Sub-routes (blob-browser, container-info, new-structured-document) and open
    // documents no longer surface a "Back to Container" action; selecting a
    // container in the sidebar returns to it.
    return null;
  }, [
    model.routeState.openSyncLanesRoute,
    model.routeState.showSelectionRoute,
    model.selectDocumentProjection,
    route,
  ]);

  useWindowBackAction(backAction);
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
            priority: 300,
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
            priority: 200,
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
            priority: 100,
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
            priority: 400,
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
    if (!show || !documentId || !model.hasSelectedDocumentLinkTargets) {
      return null;
    }

    return {
      disabled: !model.canLinkSelectedDocument,
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
    model.hasSelectedDocumentLinkTargets,
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
    if (!show || !documentId || !model.hasSelectedDocumentMoveTargets) {
      return null;
    }

    return {
      disabled: !model.canMoveSelectedDocument,
      icon: <ArrowsOutCardinalIcon aria-hidden size={18} />,
      id: "explorer-move-document",
      label: EXPLORER_LABELS.documentMoveAction,
      onClick: () => {
        model.modalState.openMoveDocumentModal(documentId);
      },
      priority: 100,
    };
  }, [
    documentId,
    model.canMoveSelectedDocument,
    model.hasSelectedDocumentMoveTargets,
    model.modalState.openMoveDocumentModal,
    show,
  ]);

  useWindowTitleBarAction(moveDocumentAction);
}
