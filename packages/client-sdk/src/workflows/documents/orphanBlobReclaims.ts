import {
  acknowledgeDocumentOrphanBlobReclaim,
  deleteOrphanedDocumentSideRows,
  isDocumentBlobStorageKeyReferenced,
  listDocumentOrphanBlobReclaims,
} from "../../data/persistence/documents/internal/orphanSideRows";
import {
  type ExecSql,
  resolveCanonicalExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { runSerializedDocumentBlobMutation } from "./blobMutationLock";
import { defaultDocumentsPersistence } from "./persistence";
import type { DocumentsWorkflowRuntimeGroups } from "./runtime";

const reclaimByExecSql = new WeakMap<ExecSql, Promise<void>>();
const reclaimRerunByExecSql = new WeakSet<ExecSql>();
const deferredStorageKeysByExecSql = new WeakMap<
  ExecSql,
  Map<string, number>
>();
const ORPHAN_BLOB_RECLAIM_BATCH_SIZE = 16;
const ORPHAN_BLOB_RECLAIM_TIME_BUDGET_MS = 250;
const ORPHAN_BLOB_RECLAIM_RETRY_DELAY_MS = 30_000;
const ORPHAN_BLOB_RECLAIM_LOG_SAMPLE_SIZE = 3;
const ORPHAN_BLOB_RECLAIM_YIELD_MS = 16;

type DocumentOrphanBlobReclaimRuntime = Pick<
  DocumentsWorkflowRuntimeGroups,
  "infra" | "util"
>;

function clearExpiredDeferredStorageKeys(
  deferredStorageKeys: Map<string, number>,
  now: number,
): void {
  for (const [storageKey, retryAt] of deferredStorageKeys) {
    if (retryAt <= now) deferredStorageKeys.delete(storageKey);
  }
}

async function reclaimQueuedBlobs(
  runtime: DocumentOrphanBlobReclaimRuntime,
): Promise<boolean> {
  const execSql = runtime.infra.execSql;
  await defaultDocumentsPersistence.ensureSchema(execSql);
  let shouldContinue = await deleteOrphanedDocumentSideRows(execSql);

  const startedAt = Date.now();
  const canonicalExecSql = resolveCanonicalExecSql(execSql);
  const deferredStorageKeys =
    deferredStorageKeysByExecSql.get(canonicalExecSql) ??
    new Map<string, number>();
  deferredStorageKeysByExecSql.set(canonicalExecSql, deferredStorageKeys);
  const failedStorageKeys: string[] = [];
  let warmedBlobStore = false;

  reclaimQueue: while (true) {
    clearExpiredDeferredStorageKeys(deferredStorageKeys, Date.now());
    const queuedStorageKeys = await listDocumentOrphanBlobReclaims(
      execSql,
      ORPHAN_BLOB_RECLAIM_BATCH_SIZE + deferredStorageKeys.size,
    );
    const storageKeys = queuedStorageKeys
      .filter((storageKey) => !deferredStorageKeys.has(storageKey))
      .slice(0, ORPHAN_BLOB_RECLAIM_BATCH_SIZE);
    if (storageKeys.length === 0) break;

    const firstStorageKey = storageKeys[0];
    if (!warmedBlobStore && firstStorageKey) {
      // Initialize lazy keyring/OPFS-backed stores before taking any blob-key
      // lock. A failed preview is harmless: deletion can still reclaim the key.
      await runtime.infra.blobStore
        .openByteSource(firstStorageKey)
        .catch(() => undefined);
      warmedBlobStore = true;
    }

    for (const storageKey of storageKeys) {
      await runSerializedDocumentBlobMutation(execSql, storageKey, async () => {
        const shouldDelete = await runSerializedSqlMutation(
          execSql,
          async (lockedExecSql) => {
            if (
              await isDocumentBlobStorageKeyReferenced(
                lockedExecSql,
                storageKey,
              )
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
          deferredStorageKeys.set(
            storageKey,
            Date.now() + ORPHAN_BLOB_RECLAIM_RETRY_DELAY_MS,
          );
        }
      });
      if (Date.now() - startedAt >= ORPHAN_BLOB_RECLAIM_TIME_BUDGET_MS) {
        shouldContinue = true;
        break reclaimQueue;
      }
    }
  }

  if (deferredStorageKeys.size === 0) {
    deferredStorageKeysByExecSql.delete(canonicalExecSql);
  }
  if (failedStorageKeys.length > 0) {
    const sample = failedStorageKeys
      .slice(0, ORPHAN_BLOB_RECLAIM_LOG_SAMPLE_SIZE)
      .join(", ");
    runtime.util.log(
      `Documents: orphan maintenance deferred ${failedStorageKeys.length} blob(s): ${sample}`,
    );
  }
  return shouldContinue;
}

/** Sweep orphan rows and reclaim their queued local attachment bytes. */
export function reclaimDocumentOrphanBlobs(
  runtime: DocumentOrphanBlobReclaimRuntime,
): Promise<void> {
  if (runtime.infra.dbStatus !== "ready") {
    return Promise.resolve();
  }
  const execSql = resolveCanonicalExecSql(runtime.infra.execSql);
  const existing = reclaimByExecSql.get(execSql);
  if (existing) {
    reclaimRerunByExecSql.add(execSql);
    return existing;
  }

  let shouldContinue = false;
  const reclaim = reclaimQueuedBlobs(runtime)
    .then((hasMore) => {
      shouldContinue = hasMore;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      runtime.util.log(`Documents: orphan maintenance failed: ${message}`);
    })
    .finally(() => {
      reclaimByExecSql.delete(execSql);
      const wasRerunRequested = reclaimRerunByExecSql.delete(execSql);
      if (shouldContinue || wasRerunRequested) {
        setTimeout(() => {
          void reclaimDocumentOrphanBlobs(runtime);
        }, ORPHAN_BLOB_RECLAIM_YIELD_MS);
      }
    });
  reclaimByExecSql.set(execSql, reclaim);
  return reclaim;
}
