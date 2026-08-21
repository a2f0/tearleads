import type { DocumentSummary } from "@symcrypt/client-sdk";
import { useCallback, useMemo } from "react";
import { useSymCrypt } from "../../../providers/sdk/SymCryptProvider";
import { useSymCryptExternalStoreSnapshot } from "../../../providers/sdk/useSymCryptSubscription";
import { useUserSystemContainers } from "../../../providers/system-bootstrap/UserSystemContainersProvider";
import { useDeviceFirstContainerContents } from "../../../stores/device-first/DeviceFirstProvider";
import {
  findTrashSystemContainerSlot,
  isContainerUnderTrashByLookup,
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
  moveToTrash: (document: DocumentSummary) => Promise<DocumentSummary | null>;
}

// Org-aware move-to-trash for mini-apps that are NOT the Explorer (Notes today).
// It mirrors Explorer's delete sequence — resolve the document's own-org Trash,
// lazily create the viewer's own Trash, no-op if already trashed — via the shared
// stores/systemContainerTrash core, then performs the container move through the
// shared device-first store; both the lazy Trash create and move persist locally
// before their remote sync lanes converge.
export function useDocumentTrash(): DocumentTrash {
  const symcrypt = useSymCrypt();
  const { containerStore: store, runtime } = useDeviceFirstContainerContents();
  const snapshot = useSymCryptExternalStoreSnapshot(store);

  const systemContainers = useUserSystemContainers();
  const trashSystemSlot = findTrashSystemContainerSlot(systemContainers);
  const currentOrganizationId = runtime.auth.organizationId;

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
    async (document: DocumentSummary): Promise<DocumentSummary | null> => {
      if (!snapshot.ready) {
        return null;
      }

      // Read the tree at call time (not a closed-over snapshot) so the lazily
      // created Trash and any concurrent tree updates are visible.
      const nodes = store.getSnapshot().nodes;
      // Never move a document out of a container the viewer can only read: that
      // would enqueue a move-intent that can never converge. Own orgs (including
      // a payment-lapsed one) retain write access, so this only blocks foreign
      // read-only shared containers.
      const sourceNode = nodes.find((node) => node.id === document.containerId);
      if (sourceNode?.effectiveAccessLevel === "read") {
        return null;
      }

      const targetContainerId = await resolveDeleteToTrashTarget({
        containerId: document.containerId,
        currentOrganizationId,
        nodes,
        trashSystemSlot,
        ensureOwnTrashContainer: () =>
          ensureTrashSystemContainer(store, trashSystemSlot),
      });
      if (!targetContainerId) {
        return null;
      }

      const documentLinks = symcrypt.containerContents.documentLinks();
      const result = await documentLinks.moveDocumentToContainer({
        expandNode: () => undefined,
        mergeDocumentSummary: () => undefined,
        note: document,
        replaceLinkedContainers: true,
        setLinkedContainerIdsForDocument: () => undefined,
        sourceContainerId: document.containerId,
        targetContainerId,
      });
      return result.note;
    },
    [currentOrganizationId, snapshot.ready, store, symcrypt, trashSystemSlot],
  );

  return { isContainerTrashed, moveToTrash, ready: snapshot.ready };
}
