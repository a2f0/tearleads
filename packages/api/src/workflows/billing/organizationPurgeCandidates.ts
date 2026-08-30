import type {
  ApiDatabase,
  DatabaseSession,
} from "@symcrypt/api-shared/postgres";
import { organizationBilling } from "@symcrypt/api-shared/schema";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

const DEFAULT_PURGE_LIMIT = 25;
const MAX_PURGE_LIMIT = 250;
const ORGANIZATION_PURGE_CLAIM_LEASE_MS = 5 * 60 * 1000;

export interface OrganizationPurgeClaim {
  readonly leaseId: string;
  readonly organizationId: string;
}

export function normalizeOrganizationPurgeLimit(
  limit: number | undefined,
): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_PURGE_LIMIT;
  }
  return Math.min(limit, MAX_PURGE_LIMIT);
}

function availablePurgePredicate(now: Date) {
  const leaseExpiredAt = new Date(
    now.getTime() - ORGANIZATION_PURGE_CLAIM_LEASE_MS,
  );
  return or(
    and(
      eq(organizationBilling.status, "disabled"),
      lte(organizationBilling.purgeAfter, now),
    ),
    and(
      eq(organizationBilling.status, "deleting"),
      or(
        isNull(organizationBilling.purgeStartedAt),
        lte(organizationBilling.purgeStartedAt, leaseExpiredAt),
      ),
    ),
  );
}

export async function listOrganizationPurgeCandidates(
  db: ApiDatabase,
  input: { readonly limit: number; readonly now: Date },
): Promise<string[]> {
  const rows = await db
    .select({ organizationId: organizationBilling.organizationId })
    .from(organizationBilling)
    .where(availablePurgePredicate(input.now))
    .orderBy(
      asc(organizationBilling.purgeAfter),
      asc(organizationBilling.purgeStartedAt),
      asc(organizationBilling.organizationId),
    )
    .limit(input.limit);
  return rows.map((row) => row.organizationId);
}

export async function claimOrganizationForPurge(
  db: ApiDatabase,
  organizationId: string,
  now: Date,
): Promise<OrganizationPurgeClaim | undefined> {
  const leaseId = crypto.randomUUID();
  const [claimed] = await db
    .update(organizationBilling)
    .set({
      purgeLeaseId: leaseId,
      purgeStartedAt: now,
      status: "deleting",
      updatedAt: now,
    })
    .where(
      and(
        eq(organizationBilling.organizationId, organizationId),
        availablePurgePredicate(now),
      ),
    )
    .returning({ organizationId: organizationBilling.organizationId });
  return claimed
    ? { leaseId, organizationId: claimed.organizationId }
    : undefined;
}

export async function renewOrganizationPurgeClaim(
  executor: DatabaseSession,
  claim: OrganizationPurgeClaim,
  now: Date,
): Promise<boolean> {
  const [renewed] = await executor
    .update(organizationBilling)
    .set({ purgeStartedAt: now, updatedAt: now })
    .where(
      and(
        eq(organizationBilling.organizationId, claim.organizationId),
        eq(organizationBilling.status, "deleting"),
        eq(organizationBilling.purgeLeaseId, claim.leaseId),
      ),
    )
    .returning({ organizationId: organizationBilling.organizationId });
  return renewed !== undefined;
}
