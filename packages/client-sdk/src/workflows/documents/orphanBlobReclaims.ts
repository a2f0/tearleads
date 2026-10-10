import { errorMessage } from "../../data/errorMessage";
import type { DocumentsPersistence } from "../../data/persistence/documents/types";
import {
  type ExecSql,
  resolveCanonicalExecSql,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { runSerializedDocumentBlobMutation } from "./blobMutationLock";
import {
  type OrphanBlobReclaimState,
  orphanBlobReclaimState,
} from "./orphanBlobReclaimState";
import { defaultDocumentsPersistence } from "./persistence";
import type { DocumentsWorkflowRuntimeGroups } from "./runtime";

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

function waitForMaintenanceYield(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ORPHAN_BLOB_RECLAIM_YIELD_MS);
  });
}

async function sweepAgedDocumentOrphans(
  execSql: ExecSql,
  persistence: DocumentsPersistence,
  state: OrphanBlobReclaimState,
): Promise<boolean> {
  let swept = false;
  await runOncePerConnection(execSql, state.sweepKey, async () => {
    swept = true;
    while (await persistence.orphanBlobs.sweep(execSql)) {
      await waitForMaintenanceYield();
    }
  });
  return swept;
}

async function reclaimQueuedBlobs(
  runtime: DocumentOrphanBlobReclaimRuntime,
  persistence: DocumentsPersistence,
  state: OrphanBlobReclaimState,
): Promise<boolean> {
  const execSql = runtime.infra.execSql;
  await persistence.ensureSchema(execSql);
  let shouldContinue = false;

  const startedAt = Date.now();
  const { deferredStorageKeys } = state;
  const failedStorageKeys: string[] = [];
  let warmedBlobStore = false;
  let sweptAgedOrphans = false;

  reclaimQueue: while (true) {
    clearExpiredDeferredStorageKeys(deferredStorageKeys, Date.now());
    const queuedStorageKeys = await persistence.orphanBlobs.list(
      execSql,
      ORPHAN_BLOB_RECLAIM_BATCH_SIZE + deferredStorageKeys.size,
    );
    const storageKeys = queuedStorageKeys
      .filter((storageKey) => !deferredStorageKeys.has(storageKey))
      .slice(0, ORPHAN_BLOB_RECLAIM_BATCH_SIZE);
    if (storageKeys.length === 0) {
      // Explicit delete paths get priority. Once their queue is drained, sweep
      // crash residue once per connection and immediately drain what it queues.
      if (
        !sweptAgedOrphans &&
        (await sweepAgedDocumentOrphans(execSql, persistence, state))
      ) {
        sweptAgedOrphans = true;
        continue;
      }
      break;
    }

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
              await persistence.orphanBlobs.isReferenced(
                lockedExecSql,
                storageKey,
              )
            ) {
              await persistence.orphanBlobs.acknowledge(
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
            persistence.orphanBlobs.acknowledge(lockedExecSql, storageKey),
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

function runDocumentOrphanReclaims(
  runtime: DocumentOrphanBlobReclaimRuntime,
  persistence: DocumentsPersistence = defaultDocumentsPersistence,
): Promise<void> {
  if (runtime.infra.dbStatus !== "ready") {
    return Promise.resolve();
  }
  const state = orphanBlobReclaimState(
    persistence.orphanBlobs,
    resolveCanonicalExecSql(runtime.infra.execSql),
  );
  if (state.running) {
    state.rerun = true;
    return state.running;
  }

  const reclaim = (async () => {
    try {
      let hasMore: boolean;
      do {
        state.rerun = false;
        hasMore = false;
        try {
          hasMore = await reclaimQueuedBlobs(runtime, persistence, state);
        } catch (error) {
          const message = errorMessage(error);
          runtime.util.log(`Documents: orphan maintenance failed: ${message}`);
        }
        if (hasMore || state.rerun) await waitForMaintenanceYield();
      } while (hasMore || state.rerun);
    } finally {
      state.running = undefined;
      state.rerun = false;
    }
  })();
  state.running = reclaim;
  return reclaim;
}

/** Await all requested batches; maintenance failures never fail committed writes. */
export async function reclaimDocumentOrphanBlobs(
  runtime: DocumentOrphanBlobReclaimRuntime,
  persistence: DocumentsPersistence = defaultDocumentsPersistence,
): Promise<void> {
  try {
    await runDocumentOrphanReclaims(runtime, persistence);
  } catch (error) {
    runtime.util.log(
      `Documents: orphan maintenance failed: ${errorMessage(error)}`,
    );
  }
}
