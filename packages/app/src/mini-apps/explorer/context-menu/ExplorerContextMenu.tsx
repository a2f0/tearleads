import type { ContainerItemRow, ContainerNode } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { type MouseEvent, useCallback, useMemo } from "react";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
import { isContainerUnderTrash } from "../../../stores/explorer/ExplorerSystemContainers";
import {
  canCreateChildContainerByRules,
  canCreateStructuredDocumentInContainerByRules,
  canMoveContainerByRules,
  canRenameContainerByRules,
  canUploadToContainerByRules,
  canWriteContainerNode,
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
  // Whether the right-clicked folder is the Trash bin or lives anywhere under
  // it, classified per-ancestor by Trash system slot (or a foreign org's shared
  // "Trash" by name) rather than a single resolved trash id. This matches the
  // document-side gate and, crucially, is immune to a transient duplicate Trash
  // node: the id-based walk could miss when the resolved trashContainerId (from
  // the raw node list) differs from the deduped Trash the folder actually sits
  // under, which is exactly how an already-trashed folder used to keep offering
  // "Move to Trash".
  const contextMenuNodeUnderTrash =
    contextMenuNode !== undefined &&
    isContainerUnderTrash(nodes, contextMenuNode.id, {
      currentOrganizationId: rulesContext.currentOrganizationId,
      trashSystemSlot,
    });

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
    // "Empty Trash" is offered on the viewer's OWN Trash bin (the node whose
    // system slot IS the trash slot) when it is writable. There is no
    // has-children gate: the bin can hold trashed folders AND documents deleted
    // straight into it, and the context menu only sees container nodes — so
    // gating on visible child folders would wrongly hide the action for a Trash
    // that holds only deleted documents. An already-empty Trash simply completes
    // instantly. Foreign-org shared Trash is out of scope for v1 (its opaque slot
    // never matches this one).
    canEmptyTrashContextMenuNode:
      contextMenuNode !== undefined &&
      trashSystemSlot !== null &&
      (contextMenuNode.systemSlot ?? null) === trashSystemSlot &&
      canWriteContainerNode(contextMenuNode),
    // "Move to Trash" relocates a user folder (and its whole subtree) into the
    // Trash system container — the folder equivalent of deleting a document.
    // Offered for a writable, movable, non-root, non-system folder that is not
    // already under Trash (an already-trashed folder is purged, not re-trashed)
    // and only when a Trash target for its org actually exists. No has-children
    // gate: trashing carries the subtree along. Unlike the old leaf hard-delete,
    // this is reversible (restore by moving it back out).
    canMoveToTrashContextMenuNode:
      contextMenuNode !== undefined &&
      contextMenuNode.parentId !== null &&
      (contextMenuNode.systemSlot ?? null) === null &&
      canMoveContainerByRules(rulesContext, contextMenuNode) &&
      trashContainerId !== null &&
      contextMenuNode.id !== trashContainerId &&
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
  selectDocumentProjection: (localId: string, containerId: string) => void,
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
    handleSidebarDocumentContextMenu,
    handleSidebarContextMenu: handleContainerContextMenu,
  };
}
