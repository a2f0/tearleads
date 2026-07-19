import type { ContainerContentsStore } from "../stores/container-contents";
import {
  emitPersistedDocumentDeletion,
  getRegisteredDocumentStore,
} from "../stores/documents/registry";
import { requestForcedContainerReconciliation } from "../sync/reconciliation/serviceRegistry";
import {
  discardPendingWrite,
  listSyncedDocumentDiscoveryContainerIds,
} from "../workflows/container-contents/discardPendingWrite";
import type { DiscardPendingWriteItemInput } from "./containerContentsTypes";
import type { InternalWorkflowRuntimeInput } from "./workflowRuntime";

async function discardDocumentPendingWrite(
  runtime: InternalWorkflowRuntimeInput,
  localId: string,
): Promise<boolean> {
  // Read the containers to re-discover before the teardown deletes the link
  // rows the lookup depends on.
  const resyncContainerIds = await listSyncedDocumentDiscoveryContainerIds(
    runtime.infra.execSql,
    localId,
  );

  // A registered store must perform the discard itself so its in-memory state
  // is cleared with the deletion — its next persist would otherwise re-create
  // the deleted rows. Stores register on first open and stay registered for
  // the session, so this is the common path for session-edited documents.
  const openStore = getRegisteredDocumentStore(
    runtime.state.domainScope,
    localId,
    null,
  );
  const discarded = openStore
    ? await openStore.discardLocal()
    : await discardPendingWrite({
        documentProjectors: runtime.infra.documentProjectors,
        execSql: runtime.infra.execSql,
        localId,
        namespace: null,
        objectKind: "document",
      });
  if (!discarded) {
    return false;
  }

  emitPersistedDocumentDeletion(runtime.state.domainScope, localId);
  // A synced document must re-materialize with server state: its watermarks
  // were reset by the workflow, and this forces the reconciler past its
  // per-session discovered cache so re-discovery actually runs.
  requestForcedContainerReconciliation(
    runtime.state.domainScope,
    resyncContainerIds,
  );
  return true;
}

/**
 * The facade half of a write-queue discard: run the workflow with the
 * serialization and notifications the raw workflow cannot own itself.
 * Containers route through the live tree store's write chain (a queued rename
 * or move persisting after a direct deletion would silently re-create the
 * rows). Documents route through their registered store when one is open, are
 * broadcast as deleted so local projections drop them, and have their linked
 * containers force-reconciled so a synced copy re-materializes from the
 * server.
 */
export async function runDiscardPendingWrite(input: {
  item: DiscardPendingWriteItemInput;
  openTree: () => ContainerContentsStore;
  runtime: InternalWorkflowRuntimeInput;
}): Promise<boolean> {
  const { item, runtime } = input;

  if (item.objectKind === "container") {
    return input.openTree().discardContainer(item.localId);
  }

  if (item.objectKind === "document") {
    return discardDocumentPendingWrite(runtime, item.localId);
  }

  return discardPendingWrite({
    documentProjectors: runtime.infra.documentProjectors,
    execSql: runtime.infra.execSql,
    localId: item.localId,
    namespace: item.namespace ?? null,
    objectKind: item.objectKind,
  });
}
