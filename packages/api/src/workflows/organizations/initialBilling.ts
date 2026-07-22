import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingStatus,
  organizationBilling,
} from "@tearleads/api-shared/schema";
import {
  createLocalBillingFields,
  createTrialBillingFields,
  organizationSeatPeriodKey,
} from "../../billing/organizationBilling";

export type InitialOrganizationBilling = "local" | "trial";

function createInitialOrganizationBillingFields(
  initialBilling: InitialOrganizationBilling,
): {
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: Date | null;
} {
  return initialBilling === "trial"
    ? createTrialBillingFields()
    : createLocalBillingFields();
}

export async function createInitialOrganizationBillingRow(
  executor: DatabaseSession,
  organizationId: string,
  initialBilling: InitialOrganizationBilling,
): Promise<void> {
  const fields = createInitialOrganizationBillingFields(initialBilling);
  await executor.insert(organizationBilling).values({
    organizationId,
    ...fields,
    seatPeriodKey:
      fields.status === "trialing"
        ? organizationSeatPeriodKey({
            currentPeriodEndsAt: null,
            currentPeriodStartsAt: null,
            ...fields,
          })
        : null,
  });
}
