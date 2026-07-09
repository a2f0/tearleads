import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingStatus,
  organizationBilling,
} from "@tearleads/api-shared/schema";
import {
  createLocalBillingFields,
  createTrialBillingFields,
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
  await executor.insert(organizationBilling).values({
    organizationId,
    ...createInitialOrganizationBillingFields(initialBilling),
  });
}
