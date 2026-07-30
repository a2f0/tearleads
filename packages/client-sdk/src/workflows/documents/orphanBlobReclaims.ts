import {
  acknowledgeDocumentOrphanBlobReclaim,
  deleteOrphanedDocumentSideRows,
  isDocumentBlobStorageKeyReferenced,
  listDocumentOrphanBlobReclaims,
} from "../../data/persistence/documents/internal/orphanSideRows";
import {
  type ExecSql,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { runSerializedDocumentBlobMutation } from "./blobMutationLock";
import { defaultDocumentsPersistence } from "./persistence";
import type { DocumentsWorkflowRuntimeGroups } from "./runtime";

const reclaimByExecSql = new WeakMap<ExecSql, Promise<void>>();
const ORPHAN_MAINTENANCE_KEY = "maintain:document-orphans";
const ORPHAN_BLOB_RECLAIM_BATCH_SIZE = 64;

async function reclaimQueuedBlobs(
  runtime: DocumentsWorkflowRuntimeGroups,
): Promise<void> {
  const execSql = runtime.infra.execSql;
  await defaultDocumentsPersistence.ensureSchema(execSql);
  await deleteOrphanedDocumentSideRows(execSql);
  const storageKeys = await listDocumentOrphanBlobReclaims(
    execSql,
    ORPHAN_BLOB_RECLAIM_BATCH_SIZE,
  );
  const firstStorageKey = storageKeys[0];
  if (firstStorageKey) {
    // Initialize lazy keyring/OPFS-backed stores before taking any blob-key
    // lock. A failed preview is harmless: deletion can still reclaim the key.
    await runtime.infra.blobStore
      .openByteSource(firstStorageKey)
      .catch(() => undefined);
  }
  const failedStorageKeys: string[] = [];
  for (const storageKey of storageKeys) {
    await runSerializedDocumentBlobMutation(execSql, storageKey, async () => {
      const shouldDelete = await runSerializedSqlMutation(
        execSql,
        async (lockedExecSql) => {
          if (
            await isDocumentBlobStorageKeyReferenced(lockedExecSql, storageKey)
          ) {
            await acknowledgeDocumentOrphanBlobReclaim(
              lockedExecSql,
              storageKey,
            );
            return false;
          }
          return true;
        },
      );
      if (!shouldDelete) return;
      try {
        await runtime.infra.blobStore.deleteBytes(storageKey);
        await runSerializedSqlMutation(execSql, (lockedExecSql) =>
          acknowledgeDocumentOrphanBlobReclaim(lockedExecSql, storageKey),
        );
      } catch {
        failedStorageKeys.push(storageKey);
      }
    });
  }
  if (failedStorageKeys.length > 0) {
    runtime.util.log(
      `Documents: orphan maintenance deferred ${failedStorageKeys.length} blob(s): ${failedStorageKeys.join(", ")}`,
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
