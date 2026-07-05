import type { OrganizationBillingStatus } from "@tearleads/api-shared/schema";
import {
  createLocalBillingFields,
  createTrialBillingFields,
} from "../../billing/organizationBilling";

export type InitialOrganizationBilling = "local" | "trial";

export function createInitialOrganizationBillingFields(
  initialBilling: InitialOrganizationBilling,
): {
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: Date | null;
} {
  return initialBilling === "trial"
    ? createTrialBillingFields()
    : createLocalBillingFields();
}
