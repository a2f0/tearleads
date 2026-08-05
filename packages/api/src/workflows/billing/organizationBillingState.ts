import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingProvider,
  organizationBilling,
} from "@tearleads/api-shared/schema";
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

/** Returns an in-memory disabled view when an entitlement period has lapsed. */
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
