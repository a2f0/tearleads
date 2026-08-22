import {
  listPendingBlobObjectDeletions,
  recordBlobObjectDeleted,
  recordBlobObjectDeletionAttempt,
} from "../../workflows/blobs/gc/pendingBlobObjectDeletion";
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

interface ReclaimDereferencedBlobsSummary {
  readonly reclaimedCount: number;
  readonly revivedCount: number;
  readonly deletedObjectCount: number;
  readonly failedObjectDeletions: number;
}

// Reclaims blobs soft-deleted past the grace period. The workflow prunes live
// database state and persists each storage key on its audit row; this service
// drains those durable work items after commit. A failed object deletion or a
// crash before its acknowledgement leaves the key eligible for the next sweep.
export async function reclaimDereferencedBlobs(
  runtime: ApiServiceRuntime,
  input: ReclaimDereferencedBlobsInput = {},
): Promise<ReclaimDereferencedBlobsSummary> {
  const result = await runReclaimDereferencedBlobsWorkflow(runtime.db, input);

  let deletedObjectCount = 0;
  let failedObjectDeletions = 0;
  const pendingDeletions = await listPendingBlobObjectDeletions(
    runtime.db,
    input.limit === undefined ? {} : { limit: input.limit },
  );
  for (
    let start = 0;
    start < pendingDeletions.length;
    start += OBJECT_DELETE_CONCURRENCY
  ) {
    const batch = pendingDeletions.slice(
      start,
      start + OBJECT_DELETE_CONCURRENCY,
    );
    await Promise.all(
      batch.map(async (pending) => {
        try {
          const shouldAttempt = await recordBlobObjectDeletionAttempt(
            runtime.db,
            { ...pending, attemptedAt: new Date() },
          );
          if (!shouldAttempt) {
            return;
          }
          await runtime.blobObjectStore.deleteObject(pending.storageKey);
          await recordBlobObjectDeleted(runtime.db, {
            ...pending,
            objectDeletedAt: new Date(),
          });
          deletedObjectCount += 1;
        } catch {
          // The audit row still retains the storage key, so the next sweep
          // retries both an object-store failure and a lost DB acknowledgement.
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

interface BlobMaintenanceInput {
  readonly dereferencedBlobs?: ReclaimDereferencedBlobsInput;
  readonly expiredStages?: CleanupExpiredBlobStagesInput;
}

interface BlobMaintenanceSummary {
  readonly dereferencedBlobs: ReclaimDereferencedBlobsSummary;
  readonly expiredStages: Awaited<ReturnType<typeof cleanupExpiredBlobStages>>;
}

// One entrypoint for scheduled blob storage reclamation: reclaim dereferenced
// committed blobs and clean up expired stage uploads. The deployed trigger is
// scripts/blobGc.ts, run hourly by the Ansible-managed systemd timer.
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
