import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  type OrganizationBillingStatus,
  organizationBilling,
} from "@symcrypt/api-shared/schema";
import {
  createLocalBillingFields,
  createTrialBillingFields,
  organizationSeatPeriodKey,
} from "../../billing/organizationBilling";
import { freeTrialLifecycleSourceId } from "../billing/organizationTrialLifecycle";

export type InitialOrganizationBilling = "local" | "trial";

export interface CreatedInitialOrganizationBilling {
  readonly createdAt: Date;
  readonly sourceId: string | null;
  readonly trialEndsAt: Date | null;
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
    trialExpiryAttemptCount: 0,
    trialExpiryLastError: null,
    trialExpiryNextAttemptAt: fields.trialEndsAt,
    updatedAt: now,
  });
  return {
    createdAt: now,
    sourceId:
      fields.trialEndsAt === null
        ? null
        : freeTrialLifecycleSourceId(organizationId, fields.trialEndsAt),
    trialEndsAt: fields.trialEndsAt,
  };
}
