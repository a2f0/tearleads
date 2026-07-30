import {
  acknowledgeDocumentOrphanBlobReclaim,
  isDocumentBlobStorageKeyReferenced,
  listDocumentOrphanBlobReclaims,
} from "../../data/persistence/documents/internal/orphanSideRows";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultDocumentsPersistence } from "./persistence";
import type { DocumentsWorkflowRuntimeGroups } from "./runtime";

const BLOB_RECLAIM_ATTEMPTS = 3;
const reclaimByExecSql = new WeakMap<ExecSql, Promise<void>>();

async function deleteBlobBytes(
  runtime: DocumentsWorkflowRuntimeGroups,
  storageKey: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < BLOB_RECLAIM_ATTEMPTS; attempt += 1) {
    try {
      await runtime.infra.blobStore.deleteBytes(storageKey);
      return true;
    } catch {
      // Local byte stores can fail transiently while a handle is still open.
    }
  }
  return false;
}

async function reclaimQueuedBlobs(
  runtime: DocumentsWorkflowRuntimeGroups,
): Promise<void> {
  const execSql = runtime.infra.execSql;
  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    const storageKeys = await listDocumentOrphanBlobReclaims(execSql);
    for (const storageKey of storageKeys) {
      const stillReferenced = await isDocumentBlobStorageKeyReferenced(
        execSql,
        storageKey,
      );
      if (!stillReferenced && !(await deleteBlobBytes(runtime, storageKey))) {
        runtime.util.log(
          `Documents: could not reclaim orphan blob ${storageKey}`,
        );
        continue;
      }
      await acknowledgeDocumentOrphanBlobReclaim(execSql, storageKey);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.util.log(`Documents: orphan blob maintenance failed: ${message}`);
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
  const reclaim = reclaimQueuedBlobs(runtime).finally(() => {
    reclaimByExecSql.delete(runtime.infra.execSql);
  });
  reclaimByExecSql.set(runtime.infra.execSql, reclaim);
  return reclaim;
}
