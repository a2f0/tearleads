import {
  claimDueOrganizationPurges,
  finalizeOrganizationPurge,
  type OrganizationPurgeInput,
  purgeClaimedOrganizationRemoteData,
} from "../../workflows/billing/organizationPurge";
import { organizationPurgeBatches } from "../../workflows/billing/organizationPurgeBatches";
import { reclaimDereferencedBlobs } from "../blobs/blobMaintenance";
import type { ApiServiceRuntime } from "../runtime";

interface OrganizationPurgeSummary {
  readonly claimed: number;
  readonly failed: number;
  readonly purged: number;
}

export async function runOrganizationPurgeMaintenance(
  runtime: ApiServiceRuntime,
  input: OrganizationPurgeInput = {},
): Promise<OrganizationPurgeSummary> {
  const { claimedOrganizationIds, now } = await claimDueOrganizationPurges(
    runtime.db,
    input,
  );
  let failed = 0;
  for (const organizationId of claimedOrganizationIds) {
    try {
      const blobIds = await purgeClaimedOrganizationRemoteData({
        db: runtime.db,
        now,
        organizationId,
      });
      for (const batch of organizationPurgeBatches(blobIds)) {
        await reclaimDereferencedBlobs(runtime, {
          blobIds: batch,
          gracePeriodMs: 0,
          limit: batch.length,
          now,
        });
      }
    } catch (error) {
      failed += 1;
      console.error(`Organization purge failed for ${organizationId}:`, error);
    }
  }

  let purged = 0;
  for (const organizationId of claimedOrganizationIds) {
    try {
      if (
        await finalizeOrganizationPurge({ db: runtime.db, now, organizationId })
      ) {
        purged += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `Organization purge finalization failed for ${organizationId}:`,
        error,
      );
    }
  }
  return { claimed: claimedOrganizationIds.length, failed, purged };
}
