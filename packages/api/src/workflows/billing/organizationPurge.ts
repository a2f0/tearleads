import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  blobAuditObjects,
  blobContentWriteHeaders,
  blobStages,
  containers,
  documentContentWriteHeaders,
  groups,
  organizationBilling,
} from "@tearleads/api-shared/schema";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { lockPrincipalMutationInTransaction } from "../principals/principalMutationLock";
import {
  claimOrganizationForPurge,
  listOrganizationPurgeCandidates,
  normalizeOrganizationPurgeLimit,
  type OrganizationPurgeClaim,
  renewOrganizationPurgeClaim,
} from "./organizationPurgeCandidates";
import { deleteOrganizationRemoteRows } from "./organizationPurgeRows";
import {
  loadOrganizationRemotePurgeScope,
  type OrganizationRemotePurgeScope,
} from "./organizationPurgeScope";

export interface OrganizationPurgeInput {
  readonly limit?: number | undefined;
  readonly now?: Date | undefined;
  readonly organizationIds?: readonly string[] | undefined;
}

/**
 * Take the organization's principal lock, then each of its groups' locks in
 * id order, before any purge write: the same order every group policy writer
 * uses (organization, then group), so a purge waits for in-flight policy
 * transactions and none of them can keep a current state the purge deletes.
 * Only a writer holding the organization lock creates or deletes its groups,
 * so the group ids read here stay the organization's groups for the purge.
 */
async function lockOrganizationPrincipals(
  tx: DatabaseTransaction,
  organizationId: string,
): Promise<string[]> {
  await lockPrincipalMutationInTransaction(tx, "organization", organizationId);
  const groupRows = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.organizationId, organizationId))
    .orderBy(asc(groups.id));
  const groupIds = groupRows.map((row) => row.id);
  for (const groupId of groupIds) {
    await lockPrincipalMutationInTransaction(tx, "group", groupId);
  }
  return groupIds;
}

export async function purgeClaimedOrganizationRemoteData(input: {
  readonly claim: OrganizationPurgeClaim;
  readonly db: ApiDatabase;
  readonly leaseNow?: Date | undefined;
  readonly now: Date;
}): Promise<
  Pick<OrganizationRemotePurgeScope, "blobIds" | "containerIds"> | undefined
> {
  return input.db.transaction(async (tx) => {
    const groupIds = await lockOrganizationPrincipals(
      tx,
      input.claim.organizationId,
    );
    if (
      !(await renewOrganizationPurgeClaim(
        tx,
        input.claim,
        input.leaseNow ?? input.now,
      ))
    ) {
      return undefined;
    }
    const scope = await loadOrganizationRemotePurgeScope({
      executor: tx,
      organizationId: input.claim.organizationId,
    });
    await deleteOrganizationRemoteRows({
      executor: tx,
      groupIds,
      now: input.now,
      organizationId: input.claim.organizationId,
      scope,
    });
    return { blobIds: scope.blobIds, containerIds: scope.containerIds };
  });
}

export async function claimDueOrganizationPurges(
  db: ApiDatabase,
  input: OrganizationPurgeInput = {},
): Promise<{ readonly claims: OrganizationPurgeClaim[]; readonly now: Date }> {
  const now = input.now ?? new Date();
  const limit = normalizeOrganizationPurgeLimit(input.limit);
  const candidates = input.organizationIds
    ? input.organizationIds.slice(0, limit)
    : await listOrganizationPurgeCandidates(db, { limit, now });
  const claims: OrganizationPurgeClaim[] = [];
  for (const organizationId of candidates) {
    const claim = await claimOrganizationForPurge(db, organizationId, now);
    if (claim) {
      claims.push(claim);
    }
  }
  return { claims, now };
}

async function organizationPurgeIsComplete(
  db: ApiDatabase,
  organizationId: string,
): Promise<boolean> {
  const [container, documentHeader, blobHeader, pendingObject, stage] =
    await Promise.all([
      db
        .select({ id: containers.id })
        .from(containers)
        .where(eq(containers.organizationId, organizationId))
        .limit(1),
      db
        .select({ id: documentContentWriteHeaders.documentId })
        .from(documentContentWriteHeaders)
        .where(eq(documentContentWriteHeaders.organizationId, organizationId))
        .limit(1),
      db
        .select({ id: blobContentWriteHeaders.blobId })
        .from(blobContentWriteHeaders)
        .where(eq(blobContentWriteHeaders.organizationId, organizationId))
        .limit(1),
      db
        .select({ id: blobAuditObjects.blobId })
        .from(blobAuditObjects)
        .where(
          and(
            eq(blobAuditObjects.organizationId, organizationId),
            isNotNull(blobAuditObjects.liveStorageKey),
            isNull(blobAuditObjects.objectDeletedAt),
          ),
        )
        .limit(1),
      db
        .select({ id: blobStages.id })
        .from(blobStages)
        .where(eq(blobStages.organizationId, organizationId))
        .limit(1),
    ]);
  return (
    container.length === 0 &&
    documentHeader.length === 0 &&
    blobHeader.length === 0 &&
    pendingObject.length === 0 &&
    stage.length === 0
  );
}

export async function finalizeOrganizationPurge(input: {
  readonly claim: OrganizationPurgeClaim;
  readonly db: ApiDatabase;
  readonly now: Date;
}): Promise<boolean> {
  if (
    !(await organizationPurgeIsComplete(input.db, input.claim.organizationId))
  ) {
    return false;
  }
  const [updated] = await input.db
    .update(organizationBilling)
    .set({
      purgeLeaseId: null,
      purgedAt: input.now,
      status: "purged",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(organizationBilling.organizationId, input.claim.organizationId),
        eq(organizationBilling.status, "deleting"),
        eq(organizationBilling.purgeLeaseId, input.claim.leaseId),
      ),
    )
    .returning({ organizationId: organizationBilling.organizationId });
  return updated !== undefined;
}
