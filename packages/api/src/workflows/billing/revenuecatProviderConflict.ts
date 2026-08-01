import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingStatus,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { isNativeRevenueCatStore } from "./revenuecatBuyerPolicy";

const NATIVE_GRANT_CONFLICTS_WITH_STRIPE_REASON =
  "A live Stripe subscription must lapse before a native purchase can be applied";

/** Refuses a device-store grant while an existing Stripe sub may still bill. */
export async function resolveNativeStripeConflictReason(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly status: OrganizationBillingStatus;
  readonly store: string | null | undefined;
}): Promise<string | null> {
  if (
    !isNativeRevenueCatStore(input.store) ||
    (input.status !== "active" &&
      input.status !== "past_due" &&
      input.status !== "trialing")
  ) {
    return null;
  }
  const [binding] = await input.executor
    .select({
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(
      eq(organizationBillingStripeSeats.organizationId, input.organizationId),
    )
    .limit(1);
  return binding?.subscriptionId || binding?.subscriptionItemId
    ? NATIVE_GRANT_CONFLICTS_WITH_STRIPE_REASON
    : null;
}
