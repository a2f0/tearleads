import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingStatus,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { isNativeRevenueCatStore } from "./revenuecatBuyerPolicy";

const NATIVE_GRANT_CONFLICTS_WITH_STRIPE_REASON =
  "Native entitlement is active while a retained Stripe subscription may still bill";

/** Detects a live Stripe identity that must remain available for cancellation. */
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
