import { ContainerPathTooDeepError } from "@tearleads/client-sdk";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { isExplorerContainerUnderTrash } from "../../../stores/explorer/ExplorerSystemContainers";
import {
  resolveDeleteToTrashTarget,
  TrashUnavailableError,
} from "../../../stores/systemContainerTrash";
import { EXPLORER_LABELS } from "../labels";
import { canAdminContainerNode } from "../model/containerRules";
import {
  type ExplorerPurgeRun,
  useExplorerPurgeRun,
} from "../purge-progress/useExplorerPurgeRun";
import { type ExplorerRoute, formatExplorerRouteSegments } from "../routes";
import type { ExplorerModelExplorer } from "./explorerModelTypes";

/** Selects `id` only if the Explorer has not moved since it was begun. */
export type ExplorerSelectionFollowUp = (id: string) => void;

/**
 * Moving to Trash and purging re-select the source container once the mutation
 * settles, so the detail pane does not linger on what was removed. Those
 * actions start from a context menu and leave the Explorer usable while the
 * mutation runs, so a user who opens another container or document meanwhile
 * must not be pulled back when it settles, and one who leaves the Explorer
 * must not have it reopened (in the routed shell, selecting navigates to the
 * Explorer's route). Call the returned function as the action begins: the
 * follow-up it hands back selects only while the Explorer is still mounted at
 * the position it captured, never after any move, even one back to it.
 */
export function useExplorerSelectionFollowUp(params: {
  route: ExplorerRoute;
  selectedId: string | null;
  selectExplorerItem: (id: string | null) => void;
}): () => ExplorerSelectionFollowUp {
  const { route, selectedId, selectExplorerItem } = params;
  // Every id the route carries, so the same document opened through another
  // container (a linked document keeps its local id) still counts as a move.
  const position = JSON.stringify([
    selectedId,
    formatExplorerRouteSegments(route, selectedId),
  ]);
  // A fresh object on every position change, compared by identity, so moving
  // away and back still retires a pending follow-up; null while the Explorer
  // is not mounted.
  const positionRef = useRef<{ readonly position: string } | null>(null);
  useLayoutEffect(() => {
    positionRef.current = { position };
    return () => {
      positionRef.current = null;
    };
  }, [position]);

  return useCallback(() => {
    const begun = positionRef.current;
    return (id: string) => {
      if (begun !== null && positionRef.current === begun) {
        selectExplorerItem(id);
      }
    };
  }, [selectExplorerItem]);
}

// Resolve the Trash a delete/trash-move should land in for the source
// container's OWN organization, lazily creating only the viewer's own Trash
// (device-first), through the same shared core as Notes and Contacts. Returns
// null when the source already lives under that Trash (the caller no-ops). A
// foreign org's Trash is never substituted, so an unavailable Trash is thrown
// as the typed TrashUnavailableError: the callers' error path logs it for the
// user (as the Notes hook does) instead of silently leaving the object in place.
export async function resolveExplorerTrashDestination(params: {
  containerId: string;
  currentOrganizationId: string | null | undefined;
  explorer: Pick<
    ExplorerModelExplorer,
    "ensureTrashContainer" | "nodes" | "trashSystemSlot"
  >;
}): Promise<string | null> {
  const { containerId, currentOrganizationId, explorer } = params;
  const target = await resolveDeleteToTrashTarget({
    containerId,
    currentOrganizationId,
    ensureOwnTrashContainer: () => explorer.ensureTrashContainer(),
    nodes: explorer.nodes,
    trashSystemSlot: explorer.trashSystemSlot,
  });
  if (target.status === "unavailable") {
    throw new TrashUnavailableError(target.reason);
  }
  return target.status === "target" ? target.trashContainerId : null;
}

interface UseExplorerContainerTrashActionsParams {
  appData: RuntimeSnapshot;
  /** Starts the re-selection a settled move makes; see the hook above. */
  beginSelectionFollowUp: () => ExplorerSelectionFollowUp;
  explorer: ExplorerModelExplorer;
  // Runs when a purge settles so the open container listing re-queries SQLite and
  // drops destroyed rows (the recursive purge only bumps the sidebar-tree
  // snapshot, not the document list).
  onSettled: () => void;
  /** Tells the user why a move to Trash was refused (the explorer banner). */
  reportBackgroundError?: ((message: string | null) => void) | undefined;
}

interface ExplorerContainerTrashActions {
  moveContainerToTrash: (containerId: string) => Promise<unknown>;
  purgeRun: ExplorerPurgeRun;
  startContainerPurge: (containerId: string) => void;
}

// Owns the container-level trash lifecycle: moving a folder to Trash, and the
// long-running "Delete Forever" / "Empty Trash" purge run (progress + cancel).
// Split out of useExplorerPanelState so the panel hook stays focused on wiring.
export function useExplorerContainerTrashActions(
  params: UseExplorerContainerTrashActionsParams,
): ExplorerContainerTrashActions {
  const {
    appData,
    beginSelectionFollowUp,
    explorer,
    onSettled,
    reportBackgroundError,
  } = params;

  const purgeRun = useExplorerPurgeRun({
    emptyTrash: explorer.emptyTrash,
    logError: appData.util.logError,
    online: appData.state.online,
    onSettled,
    purgeContainer: explorer.purgeContainer,
  });

  const startContainerPurge = useCallback(
    (containerId: string) => {
      const node = explorer.nodes.find(
        (candidate) => candidate.id === containerId,
      );
      purgeRun.startContainerPurge(containerId, node?.name ?? "");
    },
    [explorer.nodes, purgeRun.startContainerPurge],
  );

  const moveContainerToTrash = useCallback(
    async (containerId: string) => {
      const selectParent = beginSelectionFollowUp();
      try {
        const containerNode = explorer.nodes.find(
          (node) => node.id === containerId,
        );
        // Check source authority again when the menu action runs.
        if (
          !containerNode ||
          !canAdminContainerNode(containerNode) ||
          containerNode.parentId === null ||
          (containerNode.systemSlot ?? null) !== null
        ) {
          return null;
        }

        // Resolve the Trash for the folder's OWN organization (mirrors the
        // document delete path). A folder under a foreign shared root lands in
        // that org's Trash, never the viewer's personal one.
        const trashContainerId = await resolveExplorerTrashDestination({
          containerId: containerNode.id,
          currentOrganizationId: appData.auth.organizationId,
          explorer,
        });
        // No-op when the folder IS the resolved Trash or already lives anywhere
        // under it: an already-trashed folder is purged (Delete Forever), never
        // re-trashed, and moving Trash into itself is meaningless.
        if (
          !trashContainerId ||
          containerId === trashContainerId ||
          isExplorerContainerUnderTrash(
            explorer.nodes,
            containerId,
            trashContainerId,
          )
        ) {
          return null;
        }

        const movedContainer = await explorer.moveContainer(
          containerId,
          trashContainerId,
        );
        if (movedContainer) {
          // Re-select the folder's original parent so the detail pane does not
          // linger on the now-trashed subtree.
          selectParent(containerNode.parentId);
        }

        return movedContainer;
      } catch (error) {
        appData.util.logError(
          "Failed to move explorer container to trash",
          error,
        );
        // Delete Forever still works; say so instead of failing silently.
        if (error instanceof ContainerPathTooDeepError)
          reportBackgroundError?.(EXPLORER_LABELS.trashNestedTooDeeply);
        return null;
      }
    },
    [
      appData.auth.organizationId,
      appData.util.logError,
      beginSelectionFollowUp,
      explorer,
      reportBackgroundError,
    ],
  );

  return { moveContainerToTrash, purgeRun, startContainerPurge };
}
