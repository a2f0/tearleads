import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  type OrganizationBillingProvider,
  organizationBilling,
} from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  LAPSED_BILLING_PURGE_GRACE_MS,
  type OrganizationBilling,
} from "../../billing/organizationBilling";
import { OrganizationManagerError } from "../organizations/errors";

const BILLING_ROW_COLUMNS = {
  organizationId: organizationBilling.organizationId,
  status: organizationBilling.status,
  trialEndsAt: organizationBilling.trialEndsAt,
  provider: organizationBilling.provider,
  providerCustomerId: organizationBilling.providerCustomerId,
  currentPeriodStartsAt: organizationBilling.currentPeriodStartsAt,
  currentPeriodEndsAt: organizationBilling.currentPeriodEndsAt,
  seatCount: organizationBilling.seatCount,
  providerProductId: organizationBilling.providerProductId,
  disabledAt: organizationBilling.disabledAt,
  purgeAfter: organizationBilling.purgeAfter,
};

export type OrganizationBillingRow = OrganizationBilling & {
  readonly provider: OrganizationBillingProvider | null;
  readonly providerCustomerId: string | null;
  readonly providerProductId: string | null;
};

export async function loadOrganizationBilling(
  executor: DatabaseSession,
  organizationId: string,
): Promise<OrganizationBillingRow> {
  const [row] = await executor
    .select(BILLING_ROW_COLUMNS)
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId))
    .limit(1);

  if (!row) {
    throw new OrganizationManagerError("Organization billing not found", 404);
  }
  return row;
}

/**
 * Loads billing and returns an in-memory `disabled` view when an entitlement
 * period has lapsed. This is deliberately a pure read: container-access
 * projection and the billing GET route call it inside read transactions, where
 * an attempted write would poison a PostgreSQL read-replica transaction. The
 * background billing sweep owns the durable disabled transition and purge.
 */
export async function resolveOrganizationBilling(
  executor: DatabaseSession,
  organizationId: string,
  now: Date = new Date(),
): Promise<OrganizationBillingRow> {
  const billing = await loadOrganizationBilling(executor, organizationId);
  const disabledAt =
    billing.status === "trialing" &&
    billing.trialEndsAt !== null &&
    billing.trialEndsAt <= now
      ? billing.trialEndsAt
      : billing.status === "active" &&
          billing.currentPeriodEndsAt !== null &&
          billing.currentPeriodEndsAt <= now
        ? billing.currentPeriodEndsAt
        : null;
  if (disabledAt === null) return billing;

  return {
    ...billing,
    status: "disabled",
    disabledAt,
    purgeAfter: new Date(disabledAt.getTime() + LAPSED_BILLING_PURGE_GRACE_MS),
  };
}
