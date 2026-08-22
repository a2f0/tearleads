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
}

async function drainPendingBlobObjectDeletions(
  runtime: ApiServiceRuntime,
  input: ReclaimDereferencedBlobsInput,
) {
  let deletedObjectCount = 0;
  const failures: unknown[] = [];
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
        } catch (error) {
          // The audit row still retains the storage key, so the next sweep
          // retries both an object-store failure and a lost DB acknowledgement.
          failures.push(error);
        }
      }),
    );
  }

  return { deletedObjectCount, failures };
}

// Reclaims blobs soft-deleted past the grace period. The workflow prunes live
// database state and persists each storage key on its audit row; this service
// drains durable work even when a separate reclaim candidate fails validation.
// A failed object deletion or crash before acknowledgement remains retryable.
export async function reclaimDereferencedBlobs(
  runtime: ApiServiceRuntime,
  input: ReclaimDereferencedBlobsInput = {},
): Promise<ReclaimDereferencedBlobsSummary> {
  const reclaimAttempt = await runReclaimDereferencedBlobsWorkflow(
    runtime.db,
    input,
  ).then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => ({ error, ok: false as const }),
  );
  const deletionSummary = await drainPendingBlobObjectDeletions(runtime, input);
  if (!reclaimAttempt.ok || deletionSummary.failures.length > 0) {
    const failures = [
      ...(reclaimAttempt.ok ? [] : [reclaimAttempt.error]),
      ...deletionSummary.failures,
    ];
    const firstFailure = failures[0];
    const detail =
      firstFailure instanceof Error ? `: ${firstFailure.message}` : "";
    throw new AggregateError(
      failures,
      `Blob reclamation encountered ${failures.length} failure(s)${detail}`,
    );
  }

  return {
    reclaimedCount: reclaimAttempt.result.reclaimedBlobIds.length,
    revivedCount: reclaimAttempt.result.revivedBlobIds.length,
    deletedObjectCount: deletionSummary.deletedObjectCount,
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
  const dereferencedAttempt = await reclaimDereferencedBlobs(
    runtime,
    input.dereferencedBlobs,
  ).then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => ({ error, ok: false as const }),
  );
  const expiredStageAttempt = await cleanupExpiredBlobStages(
    runtime,
    input.expiredStages,
  ).then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => ({ error, ok: false as const }),
  );
  if (!dereferencedAttempt.ok || !expiredStageAttempt.ok) {
    const failures: unknown[] = [];
    if (!dereferencedAttempt.ok) {
      failures.push(dereferencedAttempt.error);
    }
    if (!expiredStageAttempt.ok) {
      failures.push(expiredStageAttempt.error);
    }
    throw new AggregateError(failures, "Blob maintenance failed");
  }

  return {
    dereferencedBlobs: dereferencedAttempt.result,
    expiredStages: expiredStageAttempt.result,
  };
}
