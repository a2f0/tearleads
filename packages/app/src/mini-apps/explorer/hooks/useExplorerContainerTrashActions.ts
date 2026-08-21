import { useCallback } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import {
  isExplorerContainerUnderTrash,
  resolveExplorerDeleteTrashTarget,
} from "../../../stores/explorer/ExplorerSystemContainers";
import {
  type ExplorerPurgeRun,
  useExplorerPurgeRun,
} from "../purge-progress/useExplorerPurgeRun";
import type { ExplorerModelExplorer } from "./explorerModelTypes";

// Resolve the Trash a delete/trash-move should land in for the source
// container's OWN organization, lazily creating only the viewer's own Trash
// (device-first). A foreign org's Trash is never substituted, so an absent one
// yields undefined and the caller aborts rather than mis-homing the object
// across orgs.
export async function resolveExplorerTrashDestination(params: {
  containerId: string;
  currentOrganizationId: string | null | undefined;
  explorer: Pick<
    ExplorerModelExplorer,
    "ensureTrashContainer" | "nodes" | "trashSystemSlot"
  >;
}): Promise<string | undefined> {
  const { containerId, currentOrganizationId, explorer } = params;
  const trashResolution = resolveExplorerDeleteTrashTarget({
    containerId,
    currentOrganizationId,
    nodes: explorer.nodes,
    trashSystemSlot: explorer.trashSystemSlot,
  });
  return (
    trashResolution.trashContainerId ??
    (trashResolution.canFallBackToOwnTrash
      ? (await explorer.ensureTrashContainer())?.id
      : undefined)
  );
}

interface UseExplorerContainerTrashActionsParams {
  appData: RuntimeSnapshot;
  explorer: ExplorerModelExplorer;
  // Runs when a purge settles so the open container listing re-queries SQLite and
  // drops destroyed rows (the recursive purge only bumps the sidebar-tree
  // snapshot, not the document list).
  onSettled: () => void;
  selectExplorerItem: (containerId: string) => void;
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
  const { appData, explorer, onSettled, selectExplorerItem } = params;

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
      try {
        const containerNode = explorer.nodes.find(
          (node) => node.id === containerId,
        );
        // Guard: an unknown, root, or system container (Trash/Contacts itself)
        // can never be trashed. The context menu already gates the action —
        // including write access and protectFromMove via
        // canMoveToTrashContextMenuNode — so this re-check just defends the
        // id-based invariants against a stale/raced invocation; write access is
        // ultimately enforced by the move outbox and the server.
        if (
          !containerNode ||
          containerNode.parentId === null ||
          (containerNode.systemSlot ?? null) !== null
        ) {
          return null;
        }

        // Resolve the Trash for the folder's OWN organization (mirrors the
        // document delete path). A folder under a foreign shared root lands in
        // that org's Trash, never the viewer's personal one.
        const trashContainerId = await resolveExplorerTrashDestination({
          containerId: containerNode.parentId,
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
          selectExplorerItem(containerNode.parentId);
        }

        return movedContainer;
      } catch (error) {
        appData.util.logError(
          "Failed to move explorer container to trash",
          error,
        );
        return null;
      }
    },
    [
      appData.auth.organizationId,
      appData.util.logError,
      explorer,
      selectExplorerItem,
    ],
  );

  return { moveContainerToTrash, purgeRun, startContainerPurge };
}
