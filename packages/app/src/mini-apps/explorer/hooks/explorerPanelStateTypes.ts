import type {
  ContainerInfo,
  ContainerItemRow,
  DocumentInfo,
  DocumentSummary,
} from "@symcrypt/client-sdk";
import type { MouseEvent } from "react";
import type { ExplorerBlobInfoLoader } from "../../../stores/explorer/blobInfo";
import type { ExplorerDocumentAttributionRangesLoader } from "../../../stores/explorer/documentInfo";
import type {
  ExplorerContainerContextMenuVariant,
  ExplorerContextMenuState,
} from "../context-menu/ExplorerContextMenu";
import type { MoveTargetOption } from "../model/targetOptions";
import type { ExplorerPurgeRun } from "../purge-progress/useExplorerPurgeRun";
import type { ExplorerDocumentMutationAction } from "./explorerModelTypes";
import type { ExplorerDocumentModalState } from "./useExplorerDocumentModalState";
import type { ExplorerRouteState } from "./useExplorerRoute";
import type { ExplorerUploadManager } from "./useExplorerUploadManager";
import type { OpenInlineDocument } from "./useInlineDocumentAction";

export interface ExplorerContextMenuModel {
  canCreateChildContextMenuNode: boolean;
  canCreateContactContextMenuNode: boolean;
  canCreateStructuredDocumentContextMenuNode: boolean;
  canEmptyTrashContextMenuNode: boolean;
  canMoveToTrashContextMenuNode: boolean;
  canMoveContextMenuNode: boolean;
  canPurgeContextMenuNode: boolean;
  canRenameContextMenuNode: boolean;
  canUploadToContextMenuNode: boolean;
  closeContextMenu: () => void;
  containerContextMenuVariant: ExplorerContainerContextMenuVariant;
  contextMenu: ExplorerContextMenuState | null;
  handleContainerContextMenu: (
    event: MouseEvent<HTMLElement>,
    nodeId: string,
  ) => void;
  handleItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  handleSidebarDocumentContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    localId: string,
    containerId: string,
  ) => void;
}

export interface ExplorerPanelState {
  activateLinkedContainer: ExplorerDocumentMutationAction;
  canMutateDocumentLinks: boolean;
  contextMenuState: ExplorerContextMenuModel;
  deleteDocument: ExplorerDocumentMutationAction;
  uploadManager: ExplorerUploadManager;
  loadBlobInfo: ExplorerBlobInfoLoader;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  loadDocumentAttributionRanges: ExplorerDocumentAttributionRangesLoader;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  modalState: ExplorerDocumentModalState;
  // Move a folder (and its whole subtree) into the Trash system container. The
  // folder counterpart to deleteDocument: a reversible relocation, not a hard
  // delete. Permanent removal is a separate step (purge) offered only once the
  // folder is already under Trash.
  moveContainerToTrash: (containerId: string) => Promise<unknown>;
  purgeRun: ExplorerPurgeRun;
  organizationNamesById: ReadonlyMap<string, string>;
  openInlineDocument: OpenInlineDocument;
  consumeInitialDocumentEditing: (localId: string) => void;
  // Marks a document to re-enter edit mode on its next mount. Used to keep a
  // structured document in edit mode across the blob-picker round-trip, which
  // navigates away and remounts it.
  markDocumentStartsInEditMode: (localId: string) => void;
  purgeDocument: (
    documentId: string,
    currentContainerId: string,
  ) => Promise<unknown>;
  routeState: ExplorerRouteState;
  selectDocumentProjection: (
    documentId: string,
    containerId: string,
    options?: { replace?: boolean | undefined },
  ) => void;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectedDocumentStartsInEditMode: boolean;
  selectedDocumentLinkTargetOptions: ReadonlyArray<MoveTargetOption>;
  selectedDocumentMoveTargetOptions: ReadonlyArray<MoveTargetOption>;
  unlinkDocument: ExplorerDocumentMutationAction;
}
