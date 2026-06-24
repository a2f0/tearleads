import type { ContainerItemRow, ContainerNode } from "@tearleads/client-sdk";
import { type MouseEvent, useCallback, useMemo } from "react";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
import {
  canCreateChildContainerByRules,
  canCreateStructuredDocumentInContainerByRules,
  canDeleteContainerByRules,
  canRenameContainerByRules,
  canUploadToContainerByRules,
  type ExplorerContainerRulesContext,
  hasContainerRules,
} from "../containerRules";
import { getMoveTargetOptions } from "../targetOptions";

export type ExplorerContextMenuTarget =
  | { kind: "container"; containerId: string }
  | { kind: "document"; containerId: string; localId: string };

export type ExplorerContextMenuState =
  ContextMenuState<ExplorerContextMenuTarget>;

export type ExplorerContainerContextMenuVariant =
  | "contacts"
  | "default"
  | "system";

function getExplorerContextMenuNodeCapabilities(params: {
  contextMenuNode: ContainerNode | undefined;
  contextMenuNodeHasChildren: boolean;
  contextMenuNodeMoveTargets: ReadonlyArray<unknown>;
  rulesContext: ExplorerContainerRulesContext;
}) {
  const {
    contextMenuNode,
    contextMenuNodeHasChildren,
    contextMenuNodeMoveTargets,
    rulesContext,
  } = params;

  return {
    canCreateChildContextMenuNode:
      contextMenuNode !== undefined &&
      canCreateChildContainerByRules(rulesContext, contextMenuNode),
    canCreateStructuredDocumentContextMenuNode:
      contextMenuNode !== undefined &&
      canCreateStructuredDocumentInContainerByRules(
        rulesContext,
        contextMenuNode,
      ),
    canDeleteContextMenuNode:
      contextMenuNode !== undefined &&
      contextMenuNode.parentId !== null &&
      !contextMenuNodeHasChildren &&
      canDeleteContainerByRules(rulesContext, contextMenuNode),
    canMoveContextMenuNode: contextMenuNodeMoveTargets.length > 0,
    canRenameContextMenuNode:
      contextMenuNode !== undefined &&
      canRenameContainerByRules(rulesContext, contextMenuNode),
    canUploadToContextMenuNode:
      contextMenuNode !== undefined &&
      canUploadToContainerByRules(rulesContext, contextMenuNode),
  };
}

function getExplorerContainerContextMenuVariant(params: {
  contextMenuNode: ContainerNode | undefined;
  rulesContext: ExplorerContainerRulesContext;
}): ExplorerContainerContextMenuVariant {
  const { contextMenuNode, rulesContext } = params;
  if (!contextMenuNode) {
    return "default";
  }

  if (
    rulesContext.contactsContainerId !== null &&
    contextMenuNode.id === rulesContext.contactsContainerId
  ) {
    return "contacts";
  }

  return hasContainerRules(rulesContext, contextMenuNode)
    ? "system"
    : "default";
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
  const contextMenuNodeCapabilities = getExplorerContextMenuNodeCapabilities({
    contextMenuNode,
    contextMenuNodeHasChildren,
    contextMenuNodeMoveTargets,
    rulesContext,
  });

  return {
    ...contextMenuNodeCapabilities,
    containerContextMenuVariant: getExplorerContainerContextMenuVariant({
      contextMenuNode,
      rulesContext,
    }),
    closeContextMenu,
    contextMenu,
    handleContainerContextMenu,
    handleItemContextMenu,
    handleSidebarDocumentContextMenu,
    handleSidebarContextMenu: handleContainerContextMenu,
  };
}
