import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingLifecycleEvents,
} from "@tearleads/api-shared/schema";

const RESET_REQUIRED_MESSAGE =
  "API database schema is not the current greenfield baseline; destroy and reprovision the database before deploying this release";

/** Fail closed when a rewritten greenfield baseline was not provisioned. */
export async function assertCurrentApiSchema(
  executor: DatabaseSession,
): Promise<void> {
  try {
    await executor
      .select({
        trialExpiryAttemptCount: organizationBilling.trialExpiryAttemptCount,
        trialExpiryLastError: organizationBilling.trialExpiryLastError,
        trialExpiryNextAttemptAt: organizationBilling.trialExpiryNextAttemptAt,
      })
      .from(organizationBilling)
      .limit(0);
    await executor
      .select({ id: organizationBillingLifecycleEvents.id })
      .from(organizationBillingLifecycleEvents)
      .limit(0);
  } catch (cause) {
    throw new Error(RESET_REQUIRED_MESSAGE, { cause });
  }
}
