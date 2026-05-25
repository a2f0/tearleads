import type { ContainerNode, StoredDocumentKind } from "@tearleads/client-sdk";
import { type MouseEvent, useCallback, useMemo } from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
import { DOCUMENT_TYPE_DEFINITIONS } from "../../../document-types/registry";
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
) {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<ExplorerContextMenuTarget>();
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  const handleSidebarContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, nodeId: string) => {
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
        : getMoveTargetOptions(nodes, contextMenuNode.id, { nodesById }),
    [contextMenuNode, nodes, nodesById],
  );

  return {
    canDeleteContextMenuNode:
      contextMenuNode !== undefined &&
      contextMenuNode.parentId !== null &&
      !contextMenuNodeHasChildren,
    canMoveContextMenuNode: contextMenuNodeMoveTargets.length > 0,
    closeContextMenu,
    contextMenu,
    contextMenuNode,
    handleSidebarDocumentContextMenu,
    handleSidebarContextMenu,
  };
}

interface ExplorerDocumentContextMenuProps {
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  closeContextMenu: () => void;
  contextMenu: ExplorerDocumentContextMenuState;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openLinkDocumentModal: (localId: string) => void;
  openMoveDocumentModal: (localId: string) => void;
  selectContainer: (containerId: string) => void;
}

function ExplorerDocumentContextMenu(params: ExplorerDocumentContextMenuProps) {
  const {
    canLinkSelectedDocument,
    canMoveSelectedDocument,
    closeContextMenu,
    contextMenu,
    openDocumentInfoRoute,
    openLinkDocumentModal,
    openMoveDocumentModal,
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
  closeContextMenu: () => void;
  contextMenu: ExplorerContainerContextMenuState;
  contextMenuNode: ContainerNode | undefined;
  openCreateChildModal: (containerId: string) => void;
  openDeleteModal: (containerId: string) => void;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
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
    closeContextMenu,
    contextMenu,
    contextMenuNode,
    openCreateChildModal,
    openDeleteModal,
    openInlineDocument,
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
      {DOCUMENT_TYPE_DEFINITIONS.map((definition) => (
        <MenuItem
          key={definition.kind}
          label={definition.createLabel}
          onClick={() => {
            if (contextMenuNode) {
              openInlineDocument(contextMenuNode.id, definition.kind);
            }
            closeContextMenu();
          }}
        />
      ))}
      <MenuItem
        label="Rename"
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
  canLinkSelectedDocument: boolean;
  canDeleteContextMenuNode: boolean;
  canMoveContextMenuNode: boolean;
  canMoveSelectedDocument: boolean;
  closeContextMenu: () => void;
  contextMenu: ExplorerContextMenuState | null;
  contextMenuNode: ContainerNode | undefined;
  openCreateChildModal: (containerId: string) => void;
  openDeleteModal: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  openLinkDocumentModal: (localId: string) => void;
  openContainerInfoRoute: (containerId: string) => void;
  openMoveModal: (containerId: string) => void;
  openMoveDocumentModal: (localId: string) => void;
  openRenameModal: (containerId: string) => void;
  selectContainer: (containerId: string) => void;
}) {
  if (!params.contextMenu) {
    return null;
  }

  if (isExplorerDocumentContextMenu(params.contextMenu)) {
    return (
      <ExplorerDocumentContextMenu
        {...params}
        contextMenu={params.contextMenu}
      />
    );
  }

  if (isExplorerContainerContextMenu(params.contextMenu)) {
    return (
      <ExplorerContainerContextMenu
        {...params}
        contextMenu={params.contextMenu}
      />
    );
  }

  return null;
}
