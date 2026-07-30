import {
  acknowledgeDocumentOrphanBlobReclaim,
  deleteOrphanedDocumentSideRows,
  isDocumentBlobStorageKeyReferenced,
  listDocumentOrphanBlobReclaims,
} from "../../data/persistence/documents/internal/orphanSideRows";
import {
  type ExecSql,
  runOncePerConnection,
} from "../../data/sqlite/sqlSchema";
import { defaultDocumentsPersistence } from "./persistence";
import type { DocumentsWorkflowRuntimeGroups } from "./runtime";

const reclaimByExecSql = new WeakMap<ExecSql, Promise<void>>();
const ORPHAN_MAINTENANCE_KEY = "maintain:document-orphans";

async function reclaimQueuedBlobs(
  runtime: DocumentsWorkflowRuntimeGroups,
): Promise<void> {
  const execSql = runtime.infra.execSql;
  await defaultDocumentsPersistence.ensureSchema(execSql);
  await deleteOrphanedDocumentSideRows(execSql);
  const storageKeys = await listDocumentOrphanBlobReclaims(execSql);
  const failedStorageKeys: string[] = [];
  for (const storageKey of storageKeys) {
    if (await isDocumentBlobStorageKeyReferenced(execSql, storageKey)) {
      await acknowledgeDocumentOrphanBlobReclaim(execSql, storageKey);
      continue;
    }
    try {
      await runtime.infra.blobStore.deleteBytes(storageKey);
      await acknowledgeDocumentOrphanBlobReclaim(execSql, storageKey);
    } catch {
      failedStorageKeys.push(storageKey);
    }
  }
  if (failedStorageKeys.length > 0) {
    throw new Error(
      `could not reclaim ${failedStorageKeys.length} orphan blob(s): ${failedStorageKeys.join(", ")}`,
    );
  }
}

/** Sweep orphan rows and reclaim their queued local attachment bytes. */
export function reclaimDocumentOrphanBlobs(
  runtime: DocumentsWorkflowRuntimeGroups,
): Promise<void> {
  if (runtime.infra.dbStatus !== "ready") {
    return Promise.resolve();
  }
  const existing = reclaimByExecSql.get(runtime.infra.execSql);
  if (existing) {
    return existing;
  }
  const reclaim = runOncePerConnection(
    runtime.infra.execSql,
    ORPHAN_MAINTENANCE_KEY,
    () => reclaimQueuedBlobs(runtime),
  )
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      runtime.util.log(`Documents: orphan maintenance failed: ${message}`);
    })
    .finally(() => reclaimByExecSql.delete(runtime.infra.execSql));
  reclaimByExecSql.set(runtime.infra.execSql, reclaim);
  return reclaim;
}
