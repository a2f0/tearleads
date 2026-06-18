import type { ContainerItemRow, ContainerNode } from "@tearleads/client-sdk";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import {
  canDeleteContainerByRules,
  canRenameContainerByRules,
  type ExplorerContainerRulesContext,
} from "../containerRules";
import { EXPLORER_LABELS } from "../labels";
import { getMoveTargetOptions } from "../targetOptions";

export type ExplorerContextMenuTarget =
  | { kind: "container"; containerId: string }
  | { kind: "document"; containerId: string; localId: string };

export type ExplorerContextMenuState =
  ContextMenuState<ExplorerContextMenuTarget>;

type ExplorerDocumentContextMenuState = ContextMenuState<
  Extract<ExplorerContextMenuTarget, { kind: "document" }>
>;

type ExplorerContainerContextMenuState = ContextMenuState<
  Extract<ExplorerContextMenuTarget, { kind: "container" }>
>;

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

export function useExplorerContextMenu(
  nodes: ReadonlyArray<ContainerNode>,
  selectContainer: (id: string | null) => void,
  selectDocumentProjection: (localId: string, containerId: string) => void,
  rulesContext: ExplorerContainerRulesContext,
) {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<ExplorerContextMenuTarget>();
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  const handleContainerContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, nodeId: string) => {
      selectContainer(nodeId);
      openContextMenu(event, { kind: "container", containerId: nodeId });
    },
    [openContextMenu, selectContainer],
  );

  const handleSidebarDocumentContextMenu = useCallback(
    (
      event: MouseEvent<HTMLButtonElement>,
      localId: string,
      containerId: string,
    ) => {
      selectDocumentProjection(localId, containerId);
      openContextMenu(event, { kind: "document", containerId, localId });
    },
    [openContextMenu, selectDocumentProjection],
  );

  // The container listing's rows reuse the same per-item menus as the sidebar,
  // but right-clicking a row must NOT navigate: a left-click in the detail pane
  // dives into a folder / opens a document, so selecting on right-click would
  // yank the pane away while the menu opens. The menus are driven entirely by
  // the target in `contextMenu.id` (containers from the node map, documents from
  // the context-menu mutation state), so we open them without touching the
  // selection.
  const handleItemContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, row: ContainerItemRow) => {
      if (row.itemKind === "container") {
        openContextMenu(event, { kind: "container", containerId: row.id });
        return;
      }

      openContextMenu(event, {
        kind: "document",
        containerId: row.containerId,
        localId: row.localId,
      });
    },
    [openContextMenu],
  );

  const contextMenuNode = contextMenu?.id
    ? contextMenu.id.kind === "container"
      ? nodesById.get(contextMenu.id.containerId)
      : undefined
    : undefined;
  const contextMenuNodeHasChildren =
    contextMenuNode !== undefined &&
    nodes.some((node) => node.parentId === contextMenuNode.id);
  const contextMenuNodeMoveTargets = useMemo(
    () =>
      contextMenuNode === undefined
        ? []
        : getMoveTargetOptions(
            nodes,
            contextMenuNode.id,
            { nodesById },
            rulesContext,
          ),
    [contextMenuNode, nodes, nodesById, rulesContext],
  );

  return {
    canDeleteContextMenuNode:
      contextMenuNode !== undefined &&
      contextMenuNode.parentId !== null &&
      !contextMenuNodeHasChildren &&
      canDeleteContainerByRules(rulesContext, contextMenuNode),
    canMoveContextMenuNode: contextMenuNodeMoveTargets.length > 0,
    canRenameContextMenuNode:
      contextMenuNode !== undefined &&
      canRenameContainerByRules(rulesContext, contextMenuNode),
    closeContextMenu,
    contextMenu,
    handleContainerContextMenu,
    handleItemContextMenu,
    handleSidebarDocumentContextMenu,
    handleSidebarContextMenu: handleContainerContextMenu,
  };
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
  canDeleteContextMenuNode: boolean;
  canMoveContextMenuNode: boolean;
  canRenameContextMenuNode: boolean;
  closeContextMenu: () => void;
  contextMenu: ExplorerContainerContextMenuState;
  triggerUpload: (containerId: string) => void;
  openCreateChildModal: (containerId: string) => void;
  openDeleteModal: (containerId: string) => void;
  openContainerInfoRoute: (containerId: string) => void;
  openMoveModal: (containerId: string) => void;
  openRenameModal: (containerId: string) => void;
}

function ExplorerContainerContextMenu(
  params: ExplorerContainerContextMenuProps,
) {
  const {
    canDeleteContextMenuNode,
    canMoveContextMenuNode,
    canRenameContextMenuNode,
    closeContextMenu,
    contextMenu,
    triggerUpload,
    openCreateChildModal,
    openDeleteModal,
    openContainerInfoRoute,
    openMoveModal,
    openRenameModal,
  } = params;
  const containerId = contextMenu.id.containerId;

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      <MenuItem
        label="Create Child"
        onClick={() => {
          closeContextMenu();
          openCreateChildModal(containerId);
        }}
      />
      <MenuItem
        label="Upload"
        onClick={() => {
          closeContextMenu();
          triggerUpload(containerId);
        }}
      />
      <MenuItem
        label="Rename"
        disabled={!canRenameContextMenuNode}
        onClick={() => {
          closeContextMenu();
          openRenameModal(containerId);
        }}
      />
      <MenuItem
        label="Move"
        disabled={!canMoveContextMenuNode}
        onClick={() => {
          closeContextMenu();
          openMoveModal(containerId);
        }}
      />
      <MenuItem
        label="Get Info"
        onClick={() => {
          closeContextMenu();
          openContainerInfoRoute(containerId);
        }}
      />
      <MenuItem
        label="Delete"
        disabled={!canDeleteContextMenuNode}
        onClick={() => {
          closeContextMenu();
          openDeleteModal(containerId);
        }}
      />
    </Menu>
  );
}

export function ExplorerContextMenuLayer(params: {
  canDeleteSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canDeleteContextMenuNode: boolean;
  canMoveContextMenuNode: boolean;
  canRenameContextMenuNode: boolean;
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
  openMoveModal: (containerId: string) => void;
  openMoveDocumentModal: (localId: string) => void;
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
              void params.importDroppedFiles(uploadContainerId, files);
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
