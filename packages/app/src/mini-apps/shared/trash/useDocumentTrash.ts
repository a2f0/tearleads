import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../../providers/sdk/useTearleadsSubscription";
import {
  findTrashSystemContainerSlot,
  isContainerUnderTrashByLookup,
  useExplorerSystemContainerSlots,
} from "../../../stores/explorer/ExplorerSystemContainers";
import {
  ensureTrashSystemContainer,
  resolveDeleteToTrashTarget,
} from "../../../stores/systemContainerTrash";

interface DocumentTrash {
  ready: boolean;
  // True when `containerId` is the viewer's Trash root or any descendant of it,
  // classified per node so it also covers a peer's shared Trash under a foreign
  // org's root. A null/undefined container (e.g. an unsaved document) is never
  // trashed.
  isContainerTrashed: (containerId: string | null | undefined) => boolean;
  // Move a document into the Trash system container of the organization it lives
  // in, lazily provisioning the viewer's own Trash when needed (so a not-yet-synced
  // org still works). Returns the moved summary, or null when the move was a no-op
  // (already trashed, no Trash resolvable/creatable, or a read-only source).
  moveToTrash: (note: DocumentSummary) => Promise<DocumentSummary | null>;
}

// Org-aware move-to-trash for mini-apps that are NOT the Explorer (Notes today).
// It mirrors Explorer's delete sequence — resolve the document's own-org Trash,
// lazily create the viewer's own Trash, no-op if already trashed — via the shared
// stores/systemContainerTrash core, then performs the container move. It opens the
// shared container tree read-only for reads; the lazy create is the only mutation.
export function useDocumentTrash(): DocumentTrash {
  const tearleads = useTearleads();
  const appData = useTearleadsRuntime();

  const runtime = useMemo(
    () => tearleads.containerContents.workflowRuntime(),
    [appData, tearleads],
  );
  const hasRootContainerId = Boolean(runtime.state.containerId);
  const store = useMemo(
    () => tearleads.containerContents.openTree({ logLabel: "Trash" }),
    [runtime.state.domainScope, tearleads],
  );
  const snapshot = useTearleadsExternalStoreSnapshot(store);

  useEffect(() => {
    if (!hasRootContainerId) {
      return;
    }

    store.updateRuntime(runtime);
  }, [hasRootContainerId, runtime, store]);

  const systemContainers = useExplorerSystemContainerSlots({
    logError: tearleads.logError,
    signingPrivateKey: runtime.crypto.signingKeyPair?.signingPrivateKey ?? null,
  });
  const trashSystemSlot = findTrashSystemContainerSlot(systemContainers);
  const currentOrganizationId = appData.auth.organizationId;

  // Build the id→node lookup once per tree snapshot: isContainerTrashed runs on
  // every render of a consuming component, so rebuilding the map on each call
  // would be wasted work.
  const nodesById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot.nodes],
  );
  const isContainerTrashed = useCallback(
    (containerId: string | null | undefined) =>
      isContainerUnderTrashByLookup(nodesById, containerId, {
        currentOrganizationId,
        trashSystemSlot,
      }),
    [currentOrganizationId, nodesById, trashSystemSlot],
  );

  const moveToTrash = useCallback(
    async (note: DocumentSummary): Promise<DocumentSummary | null> => {
      if (!snapshot.ready) {
        return null;
      }

      // Read the tree at call time (not a closed-over snapshot) so the lazily
      // created Trash and any concurrent tree updates are visible.
      const nodes = store.getSnapshot().nodes;
      // Never move a note out of a container the viewer can only read: that would
      // enqueue a move-intent that can never converge. Own orgs (including a
      // payment-lapsed one) retain write access, so this only blocks foreign
      // read-only shared containers.
      const sourceNode = nodes.find((node) => node.id === note.containerId);
      if (sourceNode?.effectiveAccessLevel === "read") {
        return null;
      }

      const targetContainerId = await resolveDeleteToTrashTarget({
        containerId: note.containerId,
        currentOrganizationId,
        nodes,
        trashSystemSlot,
        ensureOwnTrashContainer: () =>
          ensureTrashSystemContainer(store, trashSystemSlot),
      });
      if (!targetContainerId) {
        return null;
      }

      const documentLinks = tearleads.containerContents.documentLinks();
      const result = await documentLinks.moveDocumentToContainer({
        expandNode: () => undefined,
        mergeDocumentSummary: () => undefined,
        note,
        replaceLinkedContainers: true,
        setLinkedContainerIdsForDocument: () => undefined,
        sourceContainerId: note.containerId,
        targetContainerId,
      });
      return result.note;
    },
    [currentOrganizationId, snapshot.ready, store, tearleads, trashSystemSlot],
  );

  return { isContainerTrashed, moveToTrash, ready: snapshot.ready };
}
