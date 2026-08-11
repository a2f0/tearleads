import type { Icon } from "@phosphor-icons/react";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { ArrowsOutCardinalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutCardinal";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FilePlusIcon } from "@phosphor-icons/react/dist/csr/FilePlus";
import { FolderPlusIcon } from "@phosphor-icons/react/dist/csr/FolderPlus";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import type { ExplorerContextMenuModel } from "../hooks/explorerPanelStateTypes";
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
  canDownloadSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canPurgeSelectedDocument: boolean;
  closeContextMenu: () => void;
  contextMenu: ExplorerDocumentContextMenuState;
  deleteDocument: (localId: string, containerId: string) => Promise<unknown>;
  downloadDocument: (localId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openLinkDocumentModal: (localId: string) => void;
  openMoveDocumentModal: (localId: string) => void;
  purgeDocument: (localId: string, containerId: string) => Promise<unknown>;
}

function ExplorerDocumentContextMenu(params: ExplorerDocumentContextMenuProps) {
  const {
    canDeleteSelectedDocument,
    canDownloadSelectedDocument,
    canLinkSelectedDocument,
    canMoveSelectedDocument,
    canPurgeSelectedDocument,
    closeContextMenu,
    contextMenu,
    deleteDocument,
    downloadDocument,
    openDocumentInfoRoute,
    openLinkDocumentModal,
    openMoveDocumentModal,
    purgeDocument,
  } = params;

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      <MenuItem
        icon={InfoIcon}
        label={EXPLORER_LABELS.documentInfoGetInfoAction}
        onClick={() => {
          closeContextMenu();
          openDocumentInfoRoute(
            contextMenu.id.localId,
            contextMenu.id.containerId,
          );
        }}
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={DownloadSimpleIcon}
        label={EXPLORER_LABELS.documentDownloadAction}
        disabled={!canDownloadSelectedDocument}
        onSelect={() => downloadDocument(contextMenu.id.localId)}
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={LinkSimpleIcon}
        label={EXPLORER_LABELS.documentLinkAction}
        disabled={!canLinkSelectedDocument}
        onSelect={() => openLinkDocumentModal(contextMenu.id.localId)}
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={ArrowsOutCardinalIcon}
        label={EXPLORER_LABELS.documentMoveAction}
        disabled={!canMoveSelectedDocument}
        onSelect={() => openMoveDocumentModal(contextMenu.id.localId)}
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={TrashIcon}
        label={EXPLORER_LABELS.documentDeleteAction}
        disabled={!canDeleteSelectedDocument}
        onSelect={() =>
          void deleteDocument(
            contextMenu.id.localId,
            contextMenu.id.containerId,
          )
        }
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={WarningCircleIcon}
        label={EXPLORER_LABELS.documentPurgeAction}
        disabled={!canPurgeSelectedDocument}
        onSelect={() =>
          void purgeDocument(contextMenu.id.localId, contextMenu.id.containerId)
        }
      />
    </Menu>
  );
}

interface ExplorerContainerContextMenuProps {
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
  contextMenu: ExplorerContainerContextMenuState;
  containerContextMenuVariant: ExplorerContainerContextMenuVariant;
  moveContainerToTrash: (containerId: string) => Promise<unknown>;
  openEmptyTrashModal: (containerId: string) => void;
  openNewContactDocument: (containerId: string) => void;
  triggerUpload: (containerId: string) => void;
  openCreateChildModal: (containerId: string) => void;
  openContainerInfoRoute: (containerId: string) => void;
  openMoveModal: (containerId: string) => void;
  openNewStructuredDocumentRoute: (containerId: string) => void;
  openPurgeModal: (containerId: string) => void;
  openRenameModal: (containerId: string) => void;
}

type ExplorerContactsContainerContextMenuProps = Pick<
  ExplorerContainerContextMenuProps,
  | "canCreateContactContextMenuNode"
  | "closeContextMenu"
  | "contextMenu"
  | "openContainerInfoRoute"
  | "openNewContactDocument"
>;

function ExplorerContactsContainerContextMenu(
  params: ExplorerContactsContainerContextMenuProps,
) {
  const {
    canCreateContactContextMenuNode,
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
        icon={InfoIcon}
        label={EXPLORER_LABELS.documentInfoGetInfoAction}
        onClick={() => {
          closeContextMenu();
          openContainerInfoRoute(containerId);
        }}
      />
      <MenuItem
        icon={AddressBookIcon}
        label={EXPLORER_LABELS.newContactAction}
        disabled={!canCreateContactContextMenuNode}
        onClick={() => {
          closeContextMenu();
          openNewContactDocument(containerId);
        }}
      />
    </Menu>
  );
}

function ExplorerOptionalMenuItem(params: {
  closeContextMenu: () => void;
  disabled: boolean;
  icon: Icon;
  label: string;
  onSelect: () => void;
}) {
  const { closeContextMenu, disabled, icon, label, onSelect } = params;
  if (disabled) {
    return null;
  }

  return (
    <MenuItem
      icon={icon}
      label={label}
      onClick={() => {
        closeContextMenu();
        onSelect();
      }}
    />
  );
}

// The non-destructive container actions (create/upload/rename/move/info). Kept as
// a fragment so ExplorerStandardContainerContextMenu stays a thin Menu wrapper;
// Menu renders its children directly, so the split is DOM-identical.
function ExplorerContainerEditMenuItems(
  params: ExplorerContainerContextMenuProps,
) {
  const {
    canCreateChildContextMenuNode,
    canCreateStructuredDocumentContextMenuNode,
    canMoveContextMenuNode,
    canRenameContextMenuNode,
    canUploadToContextMenuNode,
    closeContextMenu,
    contextMenu,
    triggerUpload,
    openCreateChildModal,
    openContainerInfoRoute,
    openMoveModal,
    openNewStructuredDocumentRoute,
    openRenameModal,
  } = params;
  const containerId = contextMenu.id.containerId;
  const optionalActionProps = { closeContextMenu };

  return (
    <>
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={FilePlusIcon}
        label={EXPLORER_LABELS.newStructuredDocumentAction}
        disabled={!canCreateStructuredDocumentContextMenuNode}
        onSelect={() => openNewStructuredDocumentRoute(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={FolderPlusIcon}
        label={EXPLORER_LABELS.createChildFolderAction}
        disabled={!canCreateChildContextMenuNode}
        onSelect={() => openCreateChildModal(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={UploadSimpleIcon}
        label={EXPLORER_LABELS.uploadAction}
        disabled={!canUploadToContextMenuNode}
        onSelect={() => triggerUpload(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={PencilSimpleIcon}
        label="Rename"
        disabled={!canRenameContextMenuNode}
        onSelect={() => openRenameModal(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={ArrowsOutCardinalIcon}
        label="Move"
        disabled={!canMoveContextMenuNode}
        onSelect={() => openMoveModal(containerId)}
      />
      <MenuItem
        icon={InfoIcon}
        label={EXPLORER_LABELS.documentInfoGetInfoAction}
        onClick={() => {
          closeContextMenu();
          openContainerInfoRoute(containerId);
        }}
      />
    </>
  );
}

// The destructive container actions (empty-trash/move-to-trash/purge), gated
// independently by the capability flags the panel state resolves.
function ExplorerContainerDestructiveMenuItems(
  params: ExplorerContainerContextMenuProps,
) {
  const {
    canEmptyTrashContextMenuNode,
    canMoveToTrashContextMenuNode,
    canPurgeContextMenuNode,
    closeContextMenu,
    contextMenu,
    moveContainerToTrash,
    openEmptyTrashModal,
    openPurgeModal,
  } = params;
  const containerId = contextMenu.id.containerId;
  const optionalActionProps = { closeContextMenu };

  return (
    <>
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={TrashIcon}
        label={EXPLORER_LABELS.containerEmptyTrashAction}
        disabled={!canEmptyTrashContextMenuNode}
        onSelect={() => openEmptyTrashModal(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={TrashIcon}
        label={EXPLORER_LABELS.containerMoveToTrashAction}
        disabled={!canMoveToTrashContextMenuNode}
        onSelect={() => void moveContainerToTrash(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={WarningCircleIcon}
        label={EXPLORER_LABELS.documentPurgeAction}
        disabled={!canPurgeContextMenuNode}
        onSelect={() => openPurgeModal(containerId)}
      />
    </>
  );
}

function ExplorerStandardContainerContextMenu(
  params: ExplorerContainerContextMenuProps,
) {
  return (
    <Menu
      position={params.contextMenu.position}
      onClose={params.closeContextMenu}
      direction="down"
    >
      <ExplorerContainerEditMenuItems {...params} />
      <ExplorerContainerDestructiveMenuItems {...params} />
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
        canCreateContactContextMenuNode={params.canCreateContactContextMenuNode}
        contextMenu={params.contextMenu}
        openContainerInfoRoute={params.openContainerInfoRoute}
        openNewContactDocument={params.openNewContactDocument}
      />
    );
  }

  return <ExplorerStandardContainerContextMenu {...params} />;
}

// The layer takes the whole context-menu model (capability flags, variant, and
// open-state) plus the document flags and actions resolved outside it.
export function ExplorerContextMenuLayer(params: {
  canDeleteSelectedDocument: boolean;
  canDownloadSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canPurgeSelectedDocument: boolean;
  contextMenuState: ExplorerContextMenuModel;
  deleteDocument: (localId: string, containerId: string) => Promise<unknown>;
  downloadDocument: (localId: string) => void;
  moveContainerToTrash: (containerId: string) => Promise<unknown>;
  openContainerInfoRoute: (containerId: string) => void;
  openCreateChildModal: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openEmptyTrashModal: (containerId: string) => void;
  openLinkDocumentModal: (localId: string) => void;
  openMoveDocumentModal: (localId: string) => void;
  openMoveModal: (containerId: string) => void;
  openNewContactDocument: (containerId: string) => void;
  openNewStructuredDocumentRoute: (containerId: string) => void;
  openPurgeModal: (containerId: string) => void;
  openRenameModal: (containerId: string) => void;
  purgeDocument: (localId: string, containerId: string) => Promise<unknown>;
  triggerUpload: (containerId: string) => void;
}) {
  const { contextMenuState, ...actions } = params;
  const { contextMenu } = contextMenuState;
  if (!contextMenu) {
    return null;
  }

  if (isExplorerDocumentContextMenu(contextMenu)) {
    return (
      <ExplorerDocumentContextMenu
        {...actions}
        closeContextMenu={contextMenuState.closeContextMenu}
        contextMenu={contextMenu}
      />
    );
  }

  // The target union has exactly two kinds, so a non-document context menu
  // targets a container; TS cannot derive that negative narrowing across the
  // intersection types, hence the positive guard.
  if (!isExplorerContainerContextMenu(contextMenu)) {
    throw new Error("Explorer context menu target has an unknown kind.");
  }

  return (
    <ExplorerContainerContextMenu
      {...actions}
      {...contextMenuState}
      contextMenu={contextMenu}
    />
  );
}
