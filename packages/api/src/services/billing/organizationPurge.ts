import {
  claimDueOrganizationPurges,
  finalizeOrganizationPurge,
  type OrganizationPurgeInput,
  purgeClaimedOrganizationRemoteData,
} from "../../workflows/billing/organizationPurge";
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
  const claimedBlobIds = new Set<string>();
  for (const organizationId of claimedOrganizationIds) {
    try {
      const blobIds = await purgeClaimedOrganizationRemoteData({
        db: runtime.db,
        now,
        organizationId,
      });
      for (const blobId of blobIds) claimedBlobIds.add(blobId);
    } catch (error) {
      failed += 1;
      console.error(`Organization purge failed for ${organizationId}:`, error);
    }
  }

  // Organization purge removes attachment reachability with no grace. The
  // existing durable blob-GC path prunes DB key material, records object-store
  // work before deletion, and retries any failed object acknowledgement.
  if (claimedBlobIds.size > 0) {
    try {
      await reclaimDereferencedBlobs(runtime, {
        blobIds: [...claimedBlobIds],
        gracePeriodMs: 0,
        limit: 1000,
        now,
      });
    } catch (error) {
      failed += 1;
      console.error("Organization purge blob cleanup failed:", error);
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
