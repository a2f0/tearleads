import type { ContainerItemRow, ContainerNode } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  type ContextMenuState,
  useContextMenuState,
} from "@tearleads/windowing";
import { type MouseEvent, useCallback, useMemo } from "react";
import {
  isContainerUnderTrash,
  resolveExplorerDeleteTrashTarget,
} from "../../../stores/explorer/ExplorerSystemContainers";
import {
  canCreateChildContainerByRules,
  canCreateStructuredDocumentInContainerByRules,
  canMoveContainerByRules,
  canRenameContainerByRules,
  canUploadToContainerByRules,
  canWriteContainerNode,
  type ExplorerContainerRulesContext,
  hasContainerRules,
} from "../model/containerRules";
import { getMoveTargetOptions } from "../model/targetOptions";

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
  contextMenuNodeMoveTargets: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
  trashContainerId: string | null;
  trashSystemSlot: ContainerSystemSlot | null;
}) {
  const {
    contextMenuNode,
    contextMenuNodeMoveTargets,
    nodes,
    rulesContext,
    trashContainerId,
    trashSystemSlot,
  } = params;
  const contextMenuNodeUnderTrash = isContainerUnderTrash(
    nodes,
    contextMenuNode?.id,
    {
      currentOrganizationId: rulesContext.currentOrganizationId,
      trashSystemSlot,
    },
  );

  const target = resolveExplorerDeleteTrashTarget({
    containerId: contextMenuNode?.id ?? null,
    currentOrganizationId: rulesContext.currentOrganizationId,
    nodes,
    trashSystemSlot,
  });
  const targetTrashId = target.canFallBackToOwnTrash
    ? trashContainerId
    : target.trashContainerId;
  const targetTrash = nodes.find((node) => node.id === targetTrashId);

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
    canCreateContactContextMenuNode: canWriteContainerNode(contextMenuNode),
    // Bulk emptying is available in the active organization's writable Trash.
    canEmptyTrashContextMenuNode:
      contextMenuNode !== undefined &&
      target.canFallBackToOwnTrash &&
      trashSystemSlot !== null &&
      (contextMenuNode.systemSlot ?? null) === trashSystemSlot &&
      canWriteContainerNode(contextMenuNode),
    // "Move to Trash" relocates a user folder (and its whole subtree) into the
    // Trash system container — the folder equivalent of deleting a document.
    // Offered for an administered, movable, non-root, non-system folder that is not
    // already under Trash (an already-trashed folder is purged, not re-trashed)
    // and only when a Trash target for its org actually exists. No has-children
    // gate: trashing carries the subtree along. Unlike the old leaf hard-delete,
    // this is reversible (restore by moving it back out).
    canMoveToTrashContextMenuNode:
      contextMenuNode !== undefined &&
      contextMenuNode.parentId !== null &&
      (contextMenuNode.systemSlot ?? null) === null &&
      canMoveContainerByRules(rulesContext, contextMenuNode) &&
      targetTrash?.effectiveAccessLevel != null &&
      canWriteContainerNode(targetTrash) &&
      contextMenuNode.id !== targetTrashId &&
      !contextMenuNodeUnderTrash,
    canMoveContextMenuNode: contextMenuNodeMoveTargets.length > 0,
    // "Delete Forever" is offered for a user folder that has been moved into
    // trash (the root or a subfolder of it). The trash folder itself is a system
    // container and is excluded by the system-slot guard, leaving only the user
    // folders nested under trash — which is exactly what should be purgeable. A
    // non-empty folder is still purgeable (the cascade tears it down), so there
    // is no has-children gate here.
    canPurgeContextMenuNode:
      contextMenuNode !== undefined &&
      contextMenuNode.parentId !== null &&
      (contextMenuNode.systemSlot ?? null) === null &&
      canWriteContainerNode(contextMenuNode) &&
      contextMenuNodeUnderTrash,
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
  rulesContext: ExplorerContainerRulesContext,
  trashContainerId: string | null,
  trashSystemSlot: ContainerSystemSlot | null,
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

  // Open the item menu without navigating away from the container listing.
  const handleItemContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, row: ContainerItemRow) => {
      if (row.itemKind === "container") {
        openContextMenu(event, { kind: "container", containerId: row.id });
        return;
      }

      if (row.containerId === null) {
        event.preventDefault();
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
    contextMenuNodeMoveTargets,
    nodes,
    rulesContext,
    trashContainerId,
    trashSystemSlot,
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
  };
}
