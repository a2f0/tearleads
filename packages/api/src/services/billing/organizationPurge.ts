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
      const blobIds = await purgeClaimedOrganizationRemoteData({
        claim,
        db: runtime.db,
        leaseNow: clock(),
        now,
      });
      if (!blobIds) continue;
      const assertObjectDeletionLease = createLeaseGuard({
        claim,
        clock,
        runtime,
      });
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
    }
  }
  return { claimed: claims.length, failed, purged };
}
