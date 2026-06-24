import type { ReactNode } from "react";
import { useCallback, useRef } from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import { EXPLORER_LABELS } from "../labels";
import type {
  ExplorerContainerContextMenuVariant,
  ExplorerContextMenuState,
  ExplorerContextMenuTarget,
} from "./ExplorerContextMenu";

type ExplorerDocumentContextMenuState = ExplorerContextMenuState & {
  id: Extract<ExplorerContextMenuTarget, { kind: "document" }>;
};

type ExplorerContainerContextMenuState = ExplorerContextMenuState & {
  id: Extract<ExplorerContextMenuTarget, { kind: "container" }>;
};

function isExplorerDocumentContextMenu(
  contextMenu: ExplorerContextMenuState,
): contextMenu is ExplorerDocumentContextMenuState {
  return contextMenu.id.kind === "document";
}

function isExplorerContainerContextMenu(
  contextMenu: ExplorerContextMenuState,
): contextMenu is ExplorerContainerContextMenuState {
  return contextMenu.id.kind === "container";
}

interface ExplorerDocumentContextMenuProps {
  canDeleteSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canPurgeSelectedDocument: boolean;
  closeContextMenu: () => void;
  contextMenu: ExplorerDocumentContextMenuState;
  deleteDocument: (localId: string, containerId: string) => Promise<unknown>;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openLinkDocumentModal: (localId: string) => void;
  openMoveDocumentModal: (localId: string) => void;
  purgeDocument: (localId: string, containerId: string) => Promise<unknown>;
  selectContainer: (containerId: string) => void;
}

function ExplorerDocumentContextMenu(params: ExplorerDocumentContextMenuProps) {
  const {
    canDeleteSelectedDocument,
    canLinkSelectedDocument,
    canMoveSelectedDocument,
    canPurgeSelectedDocument,
    closeContextMenu,
    contextMenu,
    deleteDocument,
    openDocumentInfoRoute,
    openLinkDocumentModal,
    openMoveDocumentModal,
    purgeDocument,
    selectContainer,
  } = params;

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      <MenuItem
        label={EXPLORER_LABELS.documentInfoGetInfoAction}
        onClick={() => {
          closeContextMenu();
          openDocumentInfoRoute(
            contextMenu.id.localId,
            contextMenu.id.containerId,
          );
        }}
      />
      <MenuItem
        label={EXPLORER_LABELS.documentLinkAction}
        disabled={!canLinkSelectedDocument}
        onClick={() => {
          closeContextMenu();
          openLinkDocumentModal(contextMenu.id.localId);
        }}
      />
      <MenuItem
        label={EXPLORER_LABELS.documentMoveAction}
        disabled={!canMoveSelectedDocument}
        onClick={() => {
          closeContextMenu();
          openMoveDocumentModal(contextMenu.id.localId);
        }}
      />
      <MenuItem
        label={EXPLORER_LABELS.documentDeleteAction}
        disabled={!canDeleteSelectedDocument}
        onClick={() => {
          closeContextMenu();
          void deleteDocument(
            contextMenu.id.localId,
            contextMenu.id.containerId,
          );
        }}
      />
      <MenuItem
        label={EXPLORER_LABELS.documentPurgeAction}
        disabled={!canPurgeSelectedDocument}
        onClick={() => {
          closeContextMenu();
          void purgeDocument(
            contextMenu.id.localId,
            contextMenu.id.containerId,
          );
        }}
      />
      <MenuItem
        label={EXPLORER_LABELS.documentBackToContainerAction}
        onClick={() => {
          closeContextMenu();
          selectContainer(contextMenu.id.containerId);
        }}
      />
    </Menu>
  );
}

interface ExplorerContainerContextMenuProps {
  canCreateChildContextMenuNode: boolean;
  canCreateStructuredDocumentContextMenuNode: boolean;
  canDeleteContextMenuNode: boolean;
  canMoveContextMenuNode: boolean;
  canRenameContextMenuNode: boolean;
  canUploadToContextMenuNode: boolean;
  closeContextMenu: () => void;
  contextMenu: ExplorerContainerContextMenuState;
  containerContextMenuVariant: ExplorerContainerContextMenuVariant;
  openNewContactDocument: (containerId: string) => void;
  triggerUpload: (containerId: string) => void;
  openCreateChildModal: (containerId: string) => void;
  openDeleteModal: (containerId: string) => void;
  openContainerInfoRoute: (containerId: string) => void;
  openMoveModal: (containerId: string) => void;
  openNewStructuredDocumentRoute: (containerId: string) => void;
  openRenameModal: (containerId: string) => void;
}

type ExplorerContactsContainerContextMenuProps = Pick<
  ExplorerContainerContextMenuProps,
  | "closeContextMenu"
  | "contextMenu"
  | "openContainerInfoRoute"
  | "openNewContactDocument"
>;

function ExplorerContactsContainerContextMenu(
  params: ExplorerContactsContainerContextMenuProps,
) {
  const {
    closeContextMenu,
    contextMenu,
    openContainerInfoRoute,
    openNewContactDocument,
  } = params;
  const containerId = contextMenu.id.containerId;

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      <MenuItem
        label={EXPLORER_LABELS.documentInfoGetInfoAction}
        onClick={() => {
          closeContextMenu();
          openContainerInfoRoute(containerId);
        }}
      />
      <MenuItem
        label={EXPLORER_LABELS.newContactAction}
        onClick={() => {
          closeContextMenu();
          openNewContactDocument(containerId);
        }}
      />
    </Menu>
  );
}

function ExplorerOptionalContainerMenuItem(params: {
  closeContextMenu: () => void;
  disabled: boolean;
  hideWhenDisabled: boolean;
  label: string;
  onSelect: () => void;
}) {
  const { closeContextMenu, disabled, hideWhenDisabled, label, onSelect } =
    params;
  if (hideWhenDisabled && disabled) {
    return null;
  }

  return (
    <MenuItem
      label={label}
      disabled={disabled}
      onClick={() => {
        closeContextMenu();
        onSelect();
      }}
    />
  );
}

function ExplorerStandardContainerContextMenu(
  params: ExplorerContainerContextMenuProps,
) {
  const {
    canCreateChildContextMenuNode,
    canCreateStructuredDocumentContextMenuNode,
    canDeleteContextMenuNode,
    canMoveContextMenuNode,
    canRenameContextMenuNode,
    canUploadToContextMenuNode,
    closeContextMenu,
    contextMenu,
    containerContextMenuVariant,
    triggerUpload,
    openCreateChildModal,
    openDeleteModal,
    openContainerInfoRoute,
    openMoveModal,
    openNewStructuredDocumentRoute,
    openRenameModal,
  } = params;
  const containerId = contextMenu.id.containerId;
  const hideUnavailableActions = containerContextMenuVariant === "system";
  const optionalActionProps = {
    closeContextMenu,
    hideWhenDisabled: hideUnavailableActions,
  };

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      <ExplorerOptionalContainerMenuItem
        {...optionalActionProps}
        label="Create Child"
        disabled={!canCreateChildContextMenuNode}
        onSelect={() => openCreateChildModal(containerId)}
      />
      <ExplorerOptionalContainerMenuItem
        {...optionalActionProps}
        label={EXPLORER_LABELS.newStructuredDocumentAction}
        disabled={!canCreateStructuredDocumentContextMenuNode}
        onSelect={() => openNewStructuredDocumentRoute(containerId)}
      />
      <ExplorerOptionalContainerMenuItem
        {...optionalActionProps}
        label="Upload"
        disabled={!canUploadToContextMenuNode}
        onSelect={() => triggerUpload(containerId)}
      />
      <ExplorerOptionalContainerMenuItem
        {...optionalActionProps}
        label="Rename"
        disabled={!canRenameContextMenuNode}
        onSelect={() => openRenameModal(containerId)}
      />
      <ExplorerOptionalContainerMenuItem
        {...optionalActionProps}
        label="Move"
        disabled={!canMoveContextMenuNode}
        onSelect={() => openMoveModal(containerId)}
      />
      <MenuItem
        label={EXPLORER_LABELS.documentInfoGetInfoAction}
        onClick={() => {
          closeContextMenu();
          openContainerInfoRoute(containerId);
        }}
      />
      <ExplorerOptionalContainerMenuItem
        {...optionalActionProps}
        label="Delete"
        disabled={!canDeleteContextMenuNode}
        onSelect={() => openDeleteModal(containerId)}
      />
    </Menu>
  );
}

function ExplorerContainerContextMenu(
  params: ExplorerContainerContextMenuProps,
) {
  if (params.containerContextMenuVariant === "contacts") {
    return (
      <ExplorerContactsContainerContextMenu
        closeContextMenu={params.closeContextMenu}
        contextMenu={params.contextMenu}
        openContainerInfoRoute={params.openContainerInfoRoute}
        openNewContactDocument={params.openNewContactDocument}
      />
    );
  }

  return <ExplorerStandardContainerContextMenu {...params} />;
}

export function ExplorerContextMenuLayer(params: {
  canCreateChildContextMenuNode: boolean;
  canCreateStructuredDocumentContextMenuNode: boolean;
  containerContextMenuVariant: ExplorerContainerContextMenuVariant;
  canDeleteSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canDeleteContextMenuNode: boolean;
  canMoveContextMenuNode: boolean;
  canRenameContextMenuNode: boolean;
  canUploadToContextMenuNode: boolean;
  canMoveSelectedDocument: boolean;
  canPurgeSelectedDocument: boolean;
  closeContextMenu: () => void;
  contextMenu: ExplorerContextMenuState | null;
  deleteDocument: (localId: string, containerId: string) => Promise<unknown>;
  importDroppedFiles: ImportExplorerDroppedFiles;
  openCreateChildModal: (containerId: string) => void;
  openDeleteModal: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openLinkDocumentModal: (localId: string) => void;
  openContainerInfoRoute: (containerId: string) => void;
  openNewContactDocument: (containerId: string) => void;
  openMoveModal: (containerId: string) => void;
  openMoveDocumentModal: (localId: string) => void;
  openNewStructuredDocumentRoute: (containerId: string) => void;
  openRenameModal: (containerId: string) => void;
  purgeDocument: (localId: string, containerId: string) => Promise<unknown>;
  selectContainer: (containerId: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadContainerIdRef = useRef<string | null>(null);

  const triggerUpload = useCallback((containerId: string) => {
    uploadContainerIdRef.current = containerId;
    fileInputRef.current?.click();
  }, []);

  let menuElement: ReactNode = null;
  if (params.contextMenu) {
    if (isExplorerDocumentContextMenu(params.contextMenu)) {
      menuElement = (
        <ExplorerDocumentContextMenu
          {...params}
          contextMenu={params.contextMenu}
        />
      );
    } else if (isExplorerContainerContextMenu(params.contextMenu)) {
      menuElement = (
        <ExplorerContainerContextMenu
          {...params}
          contextMenu={params.contextMenu}
          triggerUpload={triggerUpload}
        />
      );
    }
  }

  return (
    <>
      {menuElement}
      <input
        ref={fileInputRef}
        className="explorer-file-input"
        style={{ display: "none" }}
        type="file"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          const uploadContainerId = uploadContainerIdRef.current;
          try {
            if (files.length > 0 && uploadContainerId) {
              void params
                .importDroppedFiles(uploadContainerId, files)
                .catch(() => {
                  // The importer logs per-file failures; prevent menu uploads
                  // from surfacing any exceptional rejection as unhandled.
                });
            }
          } finally {
            if (fileInputRef.current) {
              fileInputRef.current.value = "";
            }
            uploadContainerIdRef.current = null;
          }
        }}
      />
    </>
  );
}
