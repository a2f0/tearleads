import { ArrowsOutCardinalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutCardinal";
import { FilePlusIcon } from "@phosphor-icons/react/dist/csr/FilePlus";
import { FolderPlusIcon } from "@phosphor-icons/react/dist/csr/FolderPlus";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { useMemo } from "react";
import { useMiniAppDetailBackAction } from "../../components/window/useMiniAppDetailBackAction";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
import { chromeOwnsRouteBackedDetailBack } from "../../navigation/routeBackedDetailBack";
import { isExplorerOrphanedDocumentsId } from "../../stores/explorer/orphanedDocuments";
import { NewContactIcon } from "../shared/newContactIcon";
import type { useExplorerModel } from "./hooks/useExplorerModel";
import { EXPLORER_LABELS } from "./labels";
import { useExplorerHubToolbarActions } from "./toolbar/ExplorerHubToolbarActions";
import { getExplorerContainerToolbarVisibility } from "./toolbar/explorerContainerToolbarVisibility";

type ExplorerModel = ReturnType<typeof useExplorerModel>;

// Module-level icon elements: the title-bar registry compares registered
// actions structurally (Object.is per field), so a stable icon element keeps an
// unchanged action from re-registering every render — no per-action useMemo
// wrappers needed.
const CREATE_FOLDER_ICON = <FolderPlusIcon aria-hidden size={18} />;
const INFO_ICON = <InfoIcon aria-hidden size={18} />;
const LINK_DOCUMENT_ICON = <LinkSimpleIcon aria-hidden size={18} />;
const MOVE_DOCUMENT_ICON = <ArrowsOutCardinalIcon aria-hidden size={18} />;
const NEW_CONTACT_ICON = <NewContactIcon aria-hidden size={18} />;
const NEW_DOCUMENT_ICON = <FilePlusIcon aria-hidden size={18} />;
const UPLOAD_ICON = <UploadSimpleIcon aria-hidden size={18} />;

export function useExplorerRoutedChromeActions({
  historyCanGoBack,
  model,
  openStructuredDocumentGrid,
  triggerUpload,
}: {
  historyCanGoBack: boolean;
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
    !isExplorerOrphanedDocumentsId(activeContainerId) &&
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

  useExplorerRoutedBackAction({ historyCanGoBack, model, route });
  useExplorerHubToolbarActions({ model, route });
  useExplorerContainerToolbarActions({
    containerId: activeContainerId,
    model,
    openStructuredDocumentGrid,
    show: {
      ...containerToolbarVisibility,
      containerInfo: showContainerToolbar,
    },
    triggerUpload,
  });
  useExplorerDocumentToolbarActions({
    containerId: selectedDocumentContainerId,
    documentId: selectedDocumentId,
    model,
    show: showDocumentToolbar,
  });
}

// The container-selection toolbar: creation/upload actions plus Get Info. Every
// visibility flag implies a non-null active container id; the id checks below
// only narrow the type.
function useExplorerContainerToolbarActions(params: {
  containerId: string | null;
  model: ExplorerModel;
  openStructuredDocumentGrid: () => void;
  show: {
    containerInfo: boolean;
    createChild: boolean;
    createContact: boolean;
    createDocument: boolean;
    upload: boolean;
  };
  triggerUpload: (containerId: string) => void;
}) {
  const { containerId, model, show, triggerUpload } = params;
  const ready = model.explorer.ready;
  useWindowTitleBarAction(
    show.createChild && containerId
      ? {
          disabled: !ready || !model.canCreateChildInActiveContainer,
          icon: CREATE_FOLDER_ICON,
          id: "explorer-create-child-folder",
          label: EXPLORER_LABELS.createChildFolderAction,
          onClick: () => model.modalState.openCreateChildModal(containerId),
          priority: 200,
        }
      : null,
  );
  useWindowTitleBarAction(
    show.upload && containerId
      ? {
          disabled: !ready || !model.canUploadToActiveContainer,
          icon: UPLOAD_ICON,
          id: "explorer-upload",
          label: EXPLORER_LABELS.uploadAction,
          onClick: () => triggerUpload(containerId),
          priority: 300,
        }
      : null,
  );
  useWindowTitleBarAction(
    show.createDocument
      ? {
          disabled:
            !ready || !model.canCreateStructuredDocumentInActiveContainer,
          icon: NEW_DOCUMENT_ICON,
          id: "explorer-new-structured-document-toolbar",
          label: EXPLORER_LABELS.newStructuredDocumentAction,
          onClick: params.openStructuredDocumentGrid,
          priority: 400,
        }
      : null,
  );
  useWindowTitleBarAction(
    show.createContact && containerId
      ? {
          disabled: !ready || !model.canCreateContactInActiveContainer,
          icon: NEW_CONTACT_ICON,
          id: "explorer-new-contact",
          label: EXPLORER_LABELS.newContactAction,
          onClick: () => model.openInlineDocument(containerId, "contact"),
          priority: 400,
        }
      : null,
  );
  useWindowTitleBarAction(
    show.containerInfo && containerId
      ? {
          icon: INFO_ICON,
          id: "explorer-container-info",
          label: EXPLORER_LABELS.documentInfoGetInfoAction,
          onClick: () => model.routeState.openContainerInfoRoute(containerId),
          priority: 100,
        }
      : null,
  );
}

// The selected-document toolbar. Get Info stays visible (disabled) while the
// selection's container is still unresolved; Link and Move hide (rather than
// grey) when not performable — "if you can't do it, you can't see it". Their
// can-flags already require at least one target, so Link (remote-only) simply
// stays absent until a brand-new note syncs, while Move remains available for
// offline/unsynced notes because it only relocates the local containerId.
function useExplorerDocumentToolbarActions(params: {
  containerId: string | null;
  documentId: string | null;
  model: ExplorerModel;
  show: boolean;
}) {
  const { containerId, documentId, model, show } = params;
  useWindowTitleBarAction(
    show
      ? {
          disabled: !containerId || !documentId,
          icon: INFO_ICON,
          id: "explorer-document-info",
          label: EXPLORER_LABELS.documentInfoGetInfoAction,
          onClick: () => {
            if (containerId && documentId) {
              model.routeState.openDocumentInfoRoute(documentId, containerId);
            }
          },
          placement: "penultimate",
          priority: 300,
        }
      : null,
  );
  useWindowTitleBarAction(
    show && documentId && model.canLinkSelectedDocument
      ? {
          icon: LINK_DOCUMENT_ICON,
          id: "explorer-link-document",
          label: EXPLORER_LABELS.documentLinkAction,
          onClick: () => model.modalState.openLinkDocumentModal(documentId),
          priority: 200,
        }
      : null,
  );
  useWindowTitleBarAction(
    show && documentId && model.canMoveSelectedDocument
      ? {
          icon: MOVE_DOCUMENT_ICON,
          id: "explorer-move-document",
          label: EXPLORER_LABELS.documentMoveAction,
          onClick: () => model.modalState.openMoveDocumentModal(documentId),
          priority: 110,
        }
      : null,
  );
}

function useExplorerRoutedBackAction({
  historyCanGoBack,
  model,
  route,
}: {
  historyCanGoBack: boolean;
  model: ExplorerModel;
  route: ExplorerModel["routeState"]["route"];
}) {
  const ownsDetailBack = chromeOwnsRouteBackedDetailBack({ historyCanGoBack });
  const backAction = useMemo(() => {
    // Every branch below is route-backed, so wherever the host offers a Back
    // affordance it already walks out of them — and overriding that pop with a
    // route push strands Back between two entries. See
    // {@link chromeOwnsRouteBackedDetailBack}.
    if (!ownsDetailBack) {
      return null;
    }

    // Each exit REPLACES the dead-end route it leaves. This branch only runs
    // when the host has no history entry to pop, so pushing the parent would
    // create exactly one entry — and Back would then alternate between the two
    // routes forever, the loop this gate exists to prevent.
    if (route.view === "document-info") {
      return {
        label: EXPLORER_LABELS.documentInfoBackAction,
        onBack: () => {
          // The projection-aware path, not the raw route action: it resolves a
          // deleted document back to its container and activates a linked one.
          model.selectDocumentProjection(route.localId, route.containerId, {
            replace: true,
          });
        },
      };
    }

    if (route.view === "sync-lane-detail") {
      return {
        label: EXPLORER_LABELS.syncLanesBackToListAction,
        onBack: () => model.routeState.openSyncLanesRoute({ replace: true }),
      };
    }

    if (route.view === "write-queue-entry") {
      return {
        label: EXPLORER_LABELS.writeQueueBackToListAction,
        onBack: () => model.routeState.openWriteQueueRoute({ replace: true }),
      };
    }

    if (
      route.view === "sync-lanes" ||
      route.view === "write-queue" ||
      route.view === "uploads"
    ) {
      return {
        label: EXPLORER_LABELS.syncLanesBackAction,
        onBack: () => model.routeState.showSelectionRoute({ replace: true }),
      };
    }

    // A blob opened with no history behind it falls back to the origin
    // navigation maintained by useExplorerRoute, which returns an
    // attachment-opened blob to its source document.
    if (route.view === "blob-browser") {
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
    model.routeState.navigateBackFromBlobBrowser,
    model.routeState.openSyncLanesRoute,
    model.routeState.openWriteQueueRoute,
    model.routeState.showSelectionRoute,
    model.selectDocumentProjection,
    ownsDetailBack,
    route,
  ]);

  useMiniAppDetailBackAction(backAction);
}
