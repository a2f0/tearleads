import { reportBackgroundFailure } from "../../diagnostics/reportBackgroundFailure";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import { publishBestEffort } from "../../utils/publishBestEffort";
import {
  claimDueOrganizationPurges,
  finalizeOrganizationPurge,
  type OrganizationPurgeInput,
  purgeClaimedOrganizationRemoteData,
} from "../../workflows/billing/organizationPurge";
import { organizationPurgeBatches } from "../../workflows/billing/organizationPurgeBatches";
import {
  type OrganizationPurgeClaim,
  renewOrganizationPurgeClaim,
} from "../../workflows/billing/organizationPurgeCandidates";
import { reclaimDereferencedBlobs } from "../blobs/blobMaintenance";
import { cleanupExpiredBlobStages } from "../blobs/multipartStage";
import type { ApiServiceRuntime } from "../runtime";

interface OrganizationPurgeSummary {
  readonly claimed: number;
  readonly failed: number;
  readonly purged: number;
}

function createLeaseGuard(input: {
  readonly claim: OrganizationPurgeClaim;
  readonly clock: () => Date;
  readonly runtime: ApiServiceRuntime;
}) {
  return async () => {
    if (
      !(await renewOrganizationPurgeClaim(
        input.runtime.db,
        input.claim,
        input.clock(),
      ))
    ) {
      throw new Error(
        `Organization purge lease lost for ${input.claim.organizationId}`,
      );
    }
  };
}

// The purge deletes container rows without any container mutation, so nothing
// else tells a live socket its subscription now names a nonexistent container.
// Publish the same per-container invalidation a delete route would.
async function publishPurgedContainerAccessChanges(
  publish: (event: PublishedRealtimeEvent) => Promise<void>,
  containerIds: readonly string[],
): Promise<void> {
  for (const batch of organizationPurgeBatches(containerIds)) {
    await Promise.all(
      batch.map((containerId) =>
        publishBestEffort(
          publish,
          { type: "access_changed", containerId },
          "organization purge container invalidation",
        ),
      ),
    );
  }
}

export async function runOrganizationPurgeMaintenance(
  runtime: ApiServiceRuntime,
  input: OrganizationPurgeInput = {},
): Promise<OrganizationPurgeSummary> {
  const maintenanceStartedAt = Date.now();
  const { claims, now } = await claimDueOrganizationPurges(runtime.db, input);
  const clock = () =>
    new Date(now.getTime() + Math.max(0, Date.now() - maintenanceStartedAt));
  let failed = 0;
  for (const claim of claims) {
    try {
      const purged = await purgeClaimedOrganizationRemoteData({
        claim,
        db: runtime.db,
        leaseNow: clock(),
        now,
      });
      if (!purged) continue;
      const { blobIds } = purged;
      await publishPurgedContainerAccessChanges(
        runtime.eventPublisher.publish,
        purged.containerIds,
      );
      const assertObjectDeletionLease = createLeaseGuard({
        claim,
        clock,
        runtime,
      });
      while (true) {
        const stages = await cleanupExpiredBlobStages(
          runtime,
          {
            organizationId: claim.organizationId,
            now,
          },
          { assertObjectDeletionLease },
        );
        if (stages.failedStages > 0) {
          throw new AggregateError(
            stages.failures,
            "Organization staged blob cleanup failed",
          );
        }
        if (stages.scannedStages === 0) break;
      }
      for (const batch of organizationPurgeBatches(blobIds)) {
        await assertObjectDeletionLease();
        await reclaimDereferencedBlobs(
          runtime,
          {
            blobIds: batch,
            gracePeriodMs: 0,
            limit: batch.length,
            now,
          },
          { assertObjectDeletionLease },
        );
      }
    } catch (error) {
      failed += 1;
      console.error(
        `Organization purge failed for ${claim.organizationId}:`,
        error,
      );
      reportBackgroundFailure(error);
    }
  }

  let purged = 0;
  for (const claim of claims) {
    try {
      await createLeaseGuard({ claim, clock, runtime })();
      if (
        await finalizeOrganizationPurge({
          claim,
          db: runtime.db,
          now,
        })
      ) {
        purged += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `Organization purge finalization failed for ${claim.organizationId}:`,
        error,
      );
      reportBackgroundFailure(error);
    }
  }
  return { claimed: claims.length, failed, purged };
}
