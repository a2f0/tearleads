import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { revenuecatWebhookEvents } from "@tearleads/api-shared/schema";
import { and, desc, eq, or } from "drizzle-orm";

interface StripeBindingIdentity {
  readonly subscriptionId: string | null;
  readonly subscriptionItemId: string | null;
}

interface ActiveStripeBinding extends StripeBindingIdentity {
  readonly priceId: string | null;
}

/** A retained Stripe identity can still require an explicit cancellation. */
export function hasStripeBindingIdentity(
  binding: StripeBindingIdentity | undefined,
): boolean {
  return Boolean(binding?.subscriptionId || binding?.subscriptionItemId);
}

/** Only a priced Stripe binding owns entitlement and licensed-seat state. */
export function hasActiveStripeBinding(
  binding: ActiveStripeBinding | undefined,
): boolean {
  return binding?.priceId != null && hasStripeBindingIdentity(binding);
}

/** Confirms that RevenueCat applied the terminal event for this exact binding. */
export async function hasAppliedStripeExpiration(input: {
  readonly billingStatus: string;
  readonly binding: StripeBindingIdentity | undefined;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<boolean> {
  if (
    input.billingStatus !== "disabled" ||
    !hasStripeBindingIdentity(input.binding)
  ) {
    return false;
  }
  const identifiers = [
    input.binding?.subscriptionId,
    input.binding?.subscriptionItemId,
  ].filter((value): value is string => value !== null && value !== undefined);
  const identityConditions = identifiers.flatMap((identifier) => [
    eq(revenuecatWebhookEvents.originalTransactionId, identifier),
    eq(revenuecatWebhookEvents.transactionId, identifier),
  ]);
  const [latestEvent] = await input.executor
    .select({ eventType: revenuecatWebhookEvents.eventType })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.organizationId, input.organizationId),
        eq(revenuecatWebhookEvents.outcome, "applied"),
        eq(revenuecatWebhookEvents.store, "STRIPE"),
        or(...identityConditions),
      ),
    )
    .orderBy(
      desc(revenuecatWebhookEvents.eventTimestamp),
      desc(revenuecatWebhookEvents.createdAt),
      desc(revenuecatWebhookEvents.id),
    )
    .limit(1);
  return latestEvent?.eventType === "EXPIRATION";
}
