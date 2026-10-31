import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";

const DEFAULT_EXPIRY_LIMIT = 100;
const MAX_EXPIRY_LIMIT = 1000;

/** Due trials in sweep order; the idle billing probe embeds the same select. */
export function selectDueOrganizationTrials(
  db: DatabaseSession,
  input: {
    readonly limit: number;
    readonly now: Date;
    readonly organizationIds?: readonly string[] | undefined;
  },
) {
  return db
    .select({ organizationId: organizationBilling.organizationId })
    .from(organizationBilling)
    .where(
      and(
        eq(organizationBilling.status, "trialing"),
        lte(organizationBilling.trialEndsAt, input.now),
        or(
          isNull(organizationBilling.trialExpiryNextAttemptAt),
          lte(organizationBilling.trialExpiryNextAttemptAt, input.now),
        ),
        input.organizationIds
          ? inArray(organizationBilling.organizationId, [
              ...input.organizationIds,
            ])
          : undefined,
      ),
    )
    .orderBy(
      asc(organizationBilling.trialEndsAt),
      asc(organizationBilling.organizationId),
    )
    .limit(input.limit);
}

export function normalizeTrialExpiryLimit(limit: number | undefined): number {
  return Math.min(MAX_EXPIRY_LIMIT, Math.floor(limit ?? DEFAULT_EXPIRY_LIMIT));
}
