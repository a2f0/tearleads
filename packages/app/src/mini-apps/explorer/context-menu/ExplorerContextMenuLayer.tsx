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
import { Menu, MenuItem } from "@tearleads/windowing";
import { CopyIdentityLinkMenuItem } from "../../../components/identity/CopyIdentityLinkMenuItem";
import { DiagnosticMenuItem } from "../../../components/shared/DiagnosticMenuItem";
import type { DiagnosticAction } from "../../../host/AppDiagnostics";
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
  canEditContextMenuContact: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canPurgeSelectedDocument: boolean;
  closeContextMenu: () => void;
  contextMenu: ExplorerDocumentContextMenuState;
  contextMenuContactUserId: string | null;
  deleteDocument: (localId: string, containerId: string) => Promise<unknown>;
  downloadDocument: (localId: string) => void;
  editContact: (localId: string, containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openLinkDocumentModal: (localId: string) => void;
  openMoveDocumentModal: (localId: string) => void;
  purgeDocument: (localId: string, containerId: string) => Promise<unknown>;
}

function ExplorerDocumentContextMenu(params: ExplorerDocumentContextMenuProps) {
  const { closeContextMenu, contextMenu } = params;
  const { localId, containerId } = contextMenu.id;
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
          params.openDocumentInfoRoute(localId, containerId);
        }}
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={PencilSimpleIcon}
        label="Edit"
        diagnosticAction="edit"
        disabled={!params.canEditContextMenuContact}
        onSelect={() => params.editContact(localId, containerId)}
      />
      <CopyIdentityLinkMenuItem
        onSelect={closeContextMenu}
        userId={params.contextMenuContactUserId}
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={DownloadSimpleIcon}
        label={EXPLORER_LABELS.documentDownloadAction}
        diagnosticAction="export"
        disabled={!params.canDownloadSelectedDocument}
        onSelect={() => params.downloadDocument(localId)}
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={LinkSimpleIcon}
        label={EXPLORER_LABELS.documentLinkAction}
        diagnosticAction="share"
        disabled={!params.canLinkSelectedDocument}
        onSelect={() => params.openLinkDocumentModal(localId)}
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={ArrowsOutCardinalIcon}
        label={EXPLORER_LABELS.documentMoveAction}
        diagnosticAction="move"
        disabled={!params.canMoveSelectedDocument}
        onSelect={() => params.openMoveDocumentModal(localId)}
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={TrashIcon}
        label={EXPLORER_LABELS.documentDeleteAction}
        diagnosticAction="move-to-trash"
        disabled={!params.canDeleteSelectedDocument}
        onSelect={() => void params.deleteDocument(localId, containerId)}
      />
      <ExplorerOptionalMenuItem
        closeContextMenu={closeContextMenu}
        icon={WarningCircleIcon}
        label={EXPLORER_LABELS.documentPurgeAction}
        diagnosticAction="delete"
        disabled={!params.canPurgeSelectedDocument}
        onSelect={() => void params.purgeDocument(localId, containerId)}
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
      <DiagnosticMenuItem
        icon={AddressBookIcon}
        label={EXPLORER_LABELS.newContactAction}
        diagnosticAction="create"
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
  diagnosticAction: DiagnosticAction;
}) {
  const { closeContextMenu, disabled, icon, label, onSelect } = params;
  if (disabled) {
    return null;
  }

  return (
    <DiagnosticMenuItem
      icon={icon}
      label={label}
      diagnosticAction={params.diagnosticAction}
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
        diagnosticAction="create"
        disabled={!canCreateStructuredDocumentContextMenuNode}
        onSelect={() => openNewStructuredDocumentRoute(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={FolderPlusIcon}
        label={EXPLORER_LABELS.createChildFolderAction}
        diagnosticAction="create"
        disabled={!canCreateChildContextMenuNode}
        onSelect={() => openCreateChildModal(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={UploadSimpleIcon}
        label={EXPLORER_LABELS.uploadAction}
        diagnosticAction="import"
        disabled={!canUploadToContextMenuNode}
        onSelect={() => triggerUpload(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={PencilSimpleIcon}
        label="Rename"
        diagnosticAction="edit"
        disabled={!canRenameContextMenuNode}
        onSelect={() => openRenameModal(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={ArrowsOutCardinalIcon}
        label="Move"
        diagnosticAction="move"
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
        diagnosticAction="empty-trash"
        disabled={!canEmptyTrashContextMenuNode}
        onSelect={() => openEmptyTrashModal(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={TrashIcon}
        label={EXPLORER_LABELS.containerMoveToTrashAction}
        diagnosticAction="move-to-trash"
        disabled={!canMoveToTrashContextMenuNode}
        onSelect={() => void moveContainerToTrash(containerId)}
      />
      <ExplorerOptionalMenuItem
        {...optionalActionProps}
        icon={WarningCircleIcon}
        label={EXPLORER_LABELS.documentPurgeAction}
        disabled={!canPurgeContextMenuNode}
        diagnosticAction="delete"
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
  canEditContextMenuContact: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canPurgeSelectedDocument: boolean;
  contextMenuContactUserId: string | null;
  contextMenuState: ExplorerContextMenuModel;
  deleteDocument: (localId: string, containerId: string) => Promise<unknown>;
  downloadDocument: (localId: string) => void;
  editContact: (localId: string, containerId: string) => void;
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
