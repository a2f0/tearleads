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
import { freeTrialLifecycleSourceId } from "../billing/organizationTrialLifecycle";

export type InitialOrganizationBilling = "local" | "trial";

export interface CreatedInitialOrganizationBilling {
  readonly sourceId: string | null;
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: Date | null;
  readonly trialStartedAt: Date | null;
}

function createInitialOrganizationBillingFields(
  initialBilling: InitialOrganizationBilling,
  now: Date,
): {
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: Date | null;
} {
  return initialBilling === "trial"
    ? createTrialBillingFields(now)
    : createLocalBillingFields();
}

export async function createInitialOrganizationBillingRow(
  executor: DatabaseSession,
  organizationId: string,
  initialBilling: InitialOrganizationBilling,
): Promise<CreatedInitialOrganizationBilling> {
  const now = new Date();
  const fields = createInitialOrganizationBillingFields(initialBilling, now);
  await executor.insert(organizationBilling).values({
    createdAt: now,
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
    updatedAt: now,
  });
  return {
    sourceId:
      fields.trialEndsAt === null
        ? null
        : freeTrialLifecycleSourceId(organizationId, fields.trialEndsAt),
    status: fields.status,
    trialEndsAt: fields.trialEndsAt,
    trialStartedAt: fields.trialEndsAt === null ? null : now,
  };
}
