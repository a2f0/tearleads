import type { ContainerContentsStore } from "../stores/container-contents";
import { emitPersistedDocumentDeletion } from "../stores/documents/registry";
import { discardPendingWrite } from "../workflows/container-contents/discardPendingWrite";
import type { DiscardPendingWriteItemInput } from "./containerContentsTypes";
import type { InternalWorkflowRuntimeInput } from "./workflowRuntime";

/**
 * The facade half of a write-queue discard: run the workflow, then notify the
 * live state that still references the discarded object — the persisted-
 * document deletion broadcast (so an open store tears down instead of
 * resurrecting the record on its next persist) and the container tree store
 * eviction (so the snapshot stops rendering a container whose SQLite rows are
 * gone before a rename could re-persist it).
 */
export async function runDiscardPendingWrite(input: {
  item: DiscardPendingWriteItemInput;
  openTree: () => ContainerContentsStore;
  runtime: InternalWorkflowRuntimeInput;
}): Promise<boolean> {
  const { item, runtime } = input;
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
  if (item.objectKind === "container") {
    await input.openTree().evictContainer(item.localId);
  }
  return true;
}
