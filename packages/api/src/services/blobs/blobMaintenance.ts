import {
  type ReclaimDereferencedBlobsInput,
  runReclaimDereferencedBlobsWorkflow,
} from "../../workflows/blobs/gc/reclaimDereferencedBlobs";
import type { ApiServiceRuntime } from "../runtime";
import {
  type CleanupExpiredBlobStagesInput,
  cleanupExpiredBlobStages,
} from "./multipartStage";

// Bound concurrent object-store deletions so a large sweep (up to the workflow's
// 1000-blob cap) cannot exhaust sockets / the connection pool or trip provider
// rate limits.
const OBJECT_DELETE_CONCURRENCY = 16;

export interface ReclaimDereferencedBlobsSummary {
  readonly reclaimedCount: number;
  readonly revivedCount: number;
  readonly deletedObjectCount: number;
  readonly failedObjectDeletions: number;
}

// Reclaims blobs that purge soft-deleted past the grace period: the workflow
// hard-deletes the rows in their own transactions and returns the object-store
// keys, then this deletes those bytes after commit (best-effort, mirroring
// purgeDocument). Byte deletion is post-commit so a rollback never leaves a
// dangling reference and a storage failure only leaks already-reclaimable bytes.
export async function reclaimDereferencedBlobs(
  runtime: ApiServiceRuntime,
  input: ReclaimDereferencedBlobsInput = {},
): Promise<ReclaimDereferencedBlobsSummary> {
  const result = await runReclaimDereferencedBlobsWorkflow(runtime.db, input);

  let deletedObjectCount = 0;
  let failedObjectDeletions = 0;
  const storageKeys = result.reclaimedStorageKeys;
  for (
    let start = 0;
    start < storageKeys.length;
    start += OBJECT_DELETE_CONCURRENCY
  ) {
    const batch = storageKeys.slice(start, start + OBJECT_DELETE_CONCURRENCY);
    await Promise.all(
      batch.map(async (storageKey) => {
        try {
          await runtime.blobObjectStore.deleteObject(storageKey);
          deletedObjectCount += 1;
        } catch {
          // Best-effort: the blob row is already gone, so leave the bytes for the
          // next sweep rather than failing the maintenance run.
          failedObjectDeletions += 1;
        }
      }),
    );
  }

  return {
    reclaimedCount: result.reclaimedBlobIds.length,
    revivedCount: result.revivedBlobIds.length,
    deletedObjectCount,
    failedObjectDeletions,
  };
}

export interface BlobMaintenanceInput {
  readonly dereferencedBlobs?: ReclaimDereferencedBlobsInput;
  readonly expiredStages?: CleanupExpiredBlobStagesInput;
}

export interface BlobMaintenanceSummary {
  readonly dereferencedBlobs: ReclaimDereferencedBlobsSummary;
  readonly expiredStages: Awaited<ReturnType<typeof cleanupExpiredBlobStages>>;
}

// One entrypoint for scheduled blob storage reclamation: reclaim dereferenced
// committed blobs and clean up expired stage uploads. Intended to be invoked by
// an out-of-process trigger (see scripts/blobGc.ts); nothing schedules it yet.
export async function runBlobMaintenance(
  runtime: ApiServiceRuntime,
  input: BlobMaintenanceInput = {},
): Promise<BlobMaintenanceSummary> {
  const dereferencedBlobs = await reclaimDereferencedBlobs(
    runtime,
    input.dereferencedBlobs,
  );
  const expiredStages = await cleanupExpiredBlobStages(
    runtime,
    input.expiredStages,
  );
  return { dereferencedBlobs, expiredStages };
}
