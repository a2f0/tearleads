import { type MouseEvent, useCallback, useMemo } from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
import type { StoredDocumentKind } from "../../../data/documents/documentKinds";
import { DOCUMENT_TYPE_DEFINITIONS } from "../../../document-types/registry";
import type { ContainerNode } from "../../../stores/explorer/types";
import { getMoveTargetOptions } from "../targetOptions";

export type { ContextMenuState };

export function useExplorerContextMenu(
  nodes: ReadonlyArray<ContainerNode>,
  setSelectedId: (id: string | null) => void,
) {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState({ onOpen: setSelectedId });
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  const handleSidebarContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, nodeId: string) => {
      openContextMenu(event, nodeId);
    },
    [openContextMenu],
  );

  const contextMenuNode = contextMenu?.id
    ? nodesById.get(contextMenu.id)
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
  contextMenu: ContextMenuState | null;
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
          openCreateChildModal(contextMenu.id);
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
          openRenameModal(contextMenu.id);
        }}
      />
      <MenuItem
        label="Move"
        disabled={!canMoveContextMenuNode}
        onClick={() => {
          closeContextMenu();
          openMoveModal(contextMenu.id);
        }}
      />
      <MenuItem
        label="Get Info"
        onClick={() => {
          closeContextMenu();
          openContainerInfoRoute(contextMenu.id);
        }}
      />
      <MenuItem
        label="Delete"
        disabled={!canDeleteContextMenuNode}
        onClick={() => {
          closeContextMenu();
          openDeleteModal(contextMenu.id);
        }}
      />
    </Menu>
  );
}
