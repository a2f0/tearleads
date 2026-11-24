import { defaultDocumentsPersistence } from "../../workflows/documents";
import { getOrCreateDocumentStore } from "./documentStore";
import type { DocumentsRuntime } from "./types";

/**
 * Ask one synced document to pull again and re-list its attachment bindings,
 * e.g. for a pending first download in Explorer. The request names the
 * document id it was read with: when the local record has since been relinked
 * to another document, nothing runs and the caller re-reads its queue.
 *
 * The store is resolved by local id only, so an already-open store is reused
 * as-is (its runtime, draft and identity untouched) and a retry never maps one
 * local record onto another document's store. It opens on demand: the pull it
 * requests is the one it wants, so it neither runs nor joins a startup probe.
 */
export async function retryDocumentDownload(input: {
  documentId: string;
  localId: string;
  workflowRuntime: (containerId: string | null) => DocumentsRuntime;
}): Promise<boolean> {
  const { execSql, dbStatus } = input.workflowRuntime(null).infra;
  if (dbStatus !== "ready") return false;
  const record = await defaultDocumentsPersistence.loadDocument(
    execSql,
    input.localId,
  );
  if (!record || record.documentId !== input.documentId) return false;
  const runtime = input.workflowRuntime(record.containerId);
  const store = getOrCreateDocumentStore(
    runtime.state.domainScope,
    input.localId,
    runtime,
    null,
    "",
    record.documentKind,
    { remoteSyncMode: "on-demand" },
  );
  // A store nothing has opened yet loads its record before it can sync.
  if (!(await store.ensureInitialized())) return false;
  store.requestRemoteSync();
  return true;
}
