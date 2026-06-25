import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import {
  blobStages,
  groups,
  organizationRosterEntries,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { eq, sql } from "drizzle-orm";
import {
  claimAccountForPurge,
  disableExpiredTrials,
  listPurgeCandidates,
  normalizeLimit,
} from "./candidates";
import {
  deleteAccessRows,
  deleteBlobRows,
  deleteContainerRows,
  deleteDocumentRows,
  deletePrincipalRows,
} from "./deleteRows";
import { collectStorageCleanup, loadOrganizationScope } from "./scope";
import type {
  AccountPurgeInput,
  AccountPurgeResult,
  PurgedAccountSummary,
} from "./types";

export type { AccountPurgeInput } from "./types";

async function purgeClaimedAccount(
  db: ApiDatabase,
  claim: { organizationId: string; userId: string },
  now: Date,
): Promise<PurgedAccountSummary> {
  return db.transaction(async (tx) => {
    const scope = await loadOrganizationScope({
      executor: tx,
      organizationId: claim.organizationId,
    });
    const cleanup = await collectStorageCleanup({
      blobIds: scope.blobIds,
      executor: tx,
      userId: claim.userId,
    });

    await deleteAccessRows({
      eventHashes: scope.eventHashes,
      executor: tx,
      manifestHashes: scope.manifestHashes,
      organizationId: claim.organizationId,
    });
    await deleteContainerRows({
      containerIds: scope.containerIds,
      executor: tx,
      organizationId: claim.organizationId,
    });
    await deleteBlobRows({ blobIds: scope.blobIds, executor: tx });
    await tx.delete(blobStages).where(eq(blobStages.ownerUserId, claim.userId));
    await deleteDocumentRows({
      documentIds: scope.documentIds,
      executor: tx,
      updateIds: scope.updateIds,
    });
    await deletePrincipalRows({
      executor: tx,
      groupIds: scope.groupIds,
      organizationId: claim.organizationId,
    });
    await tx
      .delete(groups)
      .where(eq(groups.organizationId, claim.organizationId));
    await tx
      .delete(organizationRosterEntries)
      .where(
        eq(organizationRosterEntries.organizationId, claim.organizationId),
      );
    await tx
      .delete(organizations)
      .where(eq(organizations.id, claim.organizationId));

    await tx
      .update(users)
      .set({
        accountStatus: "purged",
        purgedAt: now,
        remoteDataEpoch: sql`${users.remoteDataEpoch} + 1`,
      })
      .where(eq(users.id, claim.userId));

    return {
      organizationId: claim.organizationId,
      userId: claim.userId,
      ...cleanup,
    };
  });
}

export async function runAccountPurgeWorkflow(
  db: ApiDatabase,
  input: AccountPurgeInput = {},
): Promise<AccountPurgeResult> {
  const now = input.now ?? new Date();
  const limit = normalizeLimit(input.limit);
  await disableExpiredTrials(db, {
    limit,
    now,
  });
  const candidates = await listPurgeCandidates(db, {
    limit,
    now,
  });
  const purgedAccounts: PurgedAccountSummary[] = [];

  for (const candidate of candidates) {
    const claim = await claimAccountForPurge(db, candidate.userId, now);
    if (!claim) {
      continue;
    }

    purgedAccounts.push(await purgeClaimedAccount(db, claim, now));
  }

  return { purgedAccounts };
}
