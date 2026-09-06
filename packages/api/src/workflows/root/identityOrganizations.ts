import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingProvider,
  type OrganizationBillingStatus,
  type OrganizationRosterStatus,
  organizationBilling,
  organizationRosterEntries,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { asc, eq } from "drizzle-orm";

export interface RootIdentityOrganizationBilling {
  readonly currentPeriodEndsAt: string | null;
  readonly disabledAt: string | null;
  readonly provider: OrganizationBillingProvider | null;
  readonly purgeAfter: string | null;
  readonly purgedAt: string | null;
  readonly seatCount: number;
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: string | null;
}

export interface RootIdentityOrganization {
  /** Null only when the organization has no billing row, which is unexpected. */
  readonly billing: RootIdentityOrganizationBilling | null;
  readonly createdAt: string;
  readonly isDefaultOrganization: boolean;
  readonly name: string;
  readonly organizationId: string;
  readonly roster: {
    readonly disabledAt: string | null;
    readonly joinedAt: string;
    readonly status: OrganizationRosterStatus;
  };
}

function isoOrNull(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/**
 * Every organization the identity appears on the roster of, joined with the
 * organization's billing row. Billing is per organization, so this is where
 * an identity's billing standing is visible. Returns null for an unknown user.
 */
export async function listRootIdentityOrganizations(
  executor: DatabaseSession,
  userId: string,
): Promise<readonly RootIdentityOrganization[] | null> {
  const [user] = await executor
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    return null;
  }

  const rows = await executor
    .select({
      billingCurrentPeriodEndsAt: organizationBilling.currentPeriodEndsAt,
      billingDisabledAt: organizationBilling.disabledAt,
      billingId: organizationBilling.id,
      billingProvider: organizationBilling.provider,
      billingPurgeAfter: organizationBilling.purgeAfter,
      billingPurgedAt: organizationBilling.purgedAt,
      billingSeatCount: organizationBilling.seatCount,
      billingStatus: organizationBilling.status,
      billingTrialEndsAt: organizationBilling.trialEndsAt,
      organizationCreatedAt: organizations.createdAt,
      organizationId: organizations.id,
      organizationName: organizations.name,
      rosterDisabledAt: organizationRosterEntries.disabledAt,
      rosterJoinedAt: organizationRosterEntries.joinedAt,
      rosterStatus: organizationRosterEntries.status,
    })
    .from(organizationRosterEntries)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationRosterEntries.organizationId),
    )
    .leftJoin(
      organizationBilling,
      eq(organizationBilling.organizationId, organizations.id),
    )
    .where(eq(organizationRosterEntries.userId, userId))
    .orderBy(asc(organizationRosterEntries.joinedAt), asc(organizations.id));

  return rows.map((row) => ({
    billing:
      row.billingId === null || row.billingStatus === null
        ? null
        : {
            currentPeriodEndsAt: isoOrNull(row.billingCurrentPeriodEndsAt),
            disabledAt: isoOrNull(row.billingDisabledAt),
            provider: row.billingProvider,
            purgeAfter: isoOrNull(row.billingPurgeAfter),
            purgedAt: isoOrNull(row.billingPurgedAt),
            seatCount: row.billingSeatCount ?? 0,
            status: row.billingStatus,
            trialEndsAt: isoOrNull(row.billingTrialEndsAt),
          },
    createdAt: row.organizationCreatedAt.toISOString(),
    isDefaultOrganization: row.organizationId === user.defaultOrganizationId,
    name: row.organizationName,
    organizationId: row.organizationId,
    roster: {
      disabledAt: isoOrNull(row.rosterDisabledAt),
      joinedAt: row.rosterJoinedAt.toISOString(),
      status: row.rosterStatus,
    },
  }));
}
