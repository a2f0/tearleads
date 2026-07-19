import type { ContainerContentsStore } from "../stores/container-contents";
import {
  emitPersistedDocumentDeletion,
  hasRegisteredDocumentStore,
} from "../stores/documents/registry";
import { discardPendingWrite } from "../workflows/container-contents/discardPendingWrite";
import type { DiscardPendingWriteItemInput } from "./containerContentsTypes";
import type { InternalWorkflowRuntimeInput } from "./workflowRuntime";

/**
 * The facade half of a write-queue discard: run the workflow with the
 * serialization and notifications the raw workflow cannot own itself.
 * Containers route through the live tree store's write chain (a queued rename
 * or move persisting after a direct deletion would silently re-create the
 * rows). Documents are refused while a live store is open — its next persist
 * would resurrect the record — and their deletion is broadcast so local
 * projections drop the discarded document.
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

  if (
    item.objectKind === "document" &&
    hasRegisteredDocumentStore(runtime.state.domainScope, item.localId, null)
  ) {
    return false;
  }

  const discarded = await discardPendingWrite({
    documentProjectors: runtime.infra.documentProjectors,
    execSql: runtime.infra.execSql,
    localId: item.localId,
    namespace: item.namespace ?? null,
    objectKind: item.objectKind,
  });
  if (!discarded) {
    return false;
  }
  if (item.objectKind === "document") {
    emitPersistedDocumentDeletion(runtime.state.domainScope, item.localId);
  }
  return true;
}
