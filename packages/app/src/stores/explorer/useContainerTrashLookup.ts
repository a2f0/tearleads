import { useCallback, useEffect, useMemo } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import {
  findTrashSystemContainerSlot,
  isContainerUnderTrashByLookup,
  useExplorerSystemContainerSlots,
} from "./ExplorerSystemContainers";

interface ContainerTrashLookup {
  ready: boolean;
  // True when `containerId` is the viewer's Trash root or any descendant of it;
  // a null/undefined container (e.g. an unsaved document) is never trashed.
  isContainerTrashed: (containerId: string | null | undefined) => boolean;
}

// Resolves the viewer's Trash subtree so a mini-app that is NOT the Explorer
// (e.g. Notes, whose list spans every container including Trash) can tell
// whether an opened object lives in the Trash and should render read-only.
//
// It opens the shared container-tree store read-only and never provisions or
// mutates a system container — system-container creation stays owned by the
// runtime system bootstrapper. Membership is classified by rules per node
// (isContainerUnderTrash), so it detects the viewer's OWN Trash AND a peer's
// shared Trash under a foreign org's root — the same org-aware resolution the
// Explorer applies.
export function useContainerTrashLookup(): ContainerTrashLookup {
  const tearleads = useTearleads();
  const appData = useTearleadsRuntime();

  const runtime = useMemo(
    () => tearleads.containerContents.workflowRuntime(),
    [appData, tearleads],
  );
  const hasRootContainerId = Boolean(runtime.state.containerId);
  const store = useMemo(
    () => tearleads.containerContents.openTree({ logLabel: "TrashLookup" }),
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

  // Build the id→node lookup once per tree snapshot: isContainerTrashed runs on
  // every render of a consuming component (e.g. the notes app), so rebuilding the
  // map inside isContainerUnderTrash on each call would be wasted work.
  const nodesById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot.nodes],
  );
  const currentOrganizationId = appData.auth.organizationId;
  const isContainerTrashed = useCallback(
    (containerId: string | null | undefined) =>
      isContainerUnderTrashByLookup(nodesById, containerId, {
        currentOrganizationId,
        trashSystemSlot,
      }),
    [currentOrganizationId, nodesById, trashSystemSlot],
  );

  return { isContainerTrashed, ready: snapshot.ready };
}
