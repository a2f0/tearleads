import { type MouseEvent, useCallback, useMemo, useState } from "react";
import { Menu, type MenuPosition } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import type { StoredDocumentKind } from "../../../data/documents/documentKinds";
import { DOCUMENT_TYPE_DEFINITIONS } from "../../../document-types/registry";
import { getMoveTargetOptions } from "../targetOptions";
import type { ContainerNode } from "../types";

export interface ContextMenuState {
  nodeId: string;
  position: MenuPosition;
}

export function useExplorerContextMenu(
  nodes: ReadonlyArray<ContainerNode>,
  setSelectedId: (id: string | null) => void,
) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  const handleSidebarContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, nodeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedId(nodeId);
      setContextMenu({
        nodeId,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [setSelectedId],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const contextMenuNode = contextMenu?.nodeId
    ? nodesById.get(contextMenu.nodeId)
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
    handleSidebarContextMenu,
  };
}

export function ExplorerContextMenuLayer(params: {
  canDeleteContextMenuNode: boolean;
  canMoveContextMenuNode: boolean;
  closeContextMenu: () => void;
  contextMenu: { nodeId: string; position: MenuPosition } | null;
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
}) {
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

  if (!contextMenu) {
    return null;
  }

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
          openCreateChildModal(contextMenu.nodeId);
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
          openRenameModal(contextMenu.nodeId);
        }}
      />
      <MenuItem
        label="Move"
        disabled={!canMoveContextMenuNode}
        onClick={() => {
          closeContextMenu();
          openMoveModal(contextMenu.nodeId);
        }}
      />
      <MenuItem
        label="Get Info"
        onClick={() => {
          closeContextMenu();
          openContainerInfoRoute(contextMenu.nodeId);
        }}
      />
      <MenuItem
        label="Delete"
        disabled={!canDeleteContextMenuNode}
        onClick={() => {
          closeContextMenu();
          openDeleteModal(contextMenu.nodeId);
        }}
      />
    </Menu>
  );
}
