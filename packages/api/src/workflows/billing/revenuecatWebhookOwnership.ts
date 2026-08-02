import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { and, eq } from "drizzle-orm";
import {
  isNativeSubscriptionMoveConflict,
  isProviderSubscriptionOwnershipConflict,
} from "../../billing/databaseErrors";
import type { RevenueCatBillingTransition } from "../../billing/revenuecatWebhook";
import type { RevenueCatWebhookOutcome } from "./revenuecatWebhookTypes";

const MOVED_SUBSCRIPTION_REASON =
  "Native subscription belongs to a different organization";

/** Records a stale lifecycle delivery after an explicit ownership move. */
async function ignoreLifecycleEventForMovedSubscription(input: {
  readonly db: ApiDatabase;
  readonly event: RevenueCatWebhookEvent;
  readonly organizationId: string;
  readonly subscriptionId: string;
}): Promise<RevenueCatWebhookOutcome | null> {
  return input.db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ organizationId: organizationBilling.organizationId })
      .from(organizationBilling)
      .where(
        and(
          eq(organizationBilling.provider, "revenuecat"),
          eq(organizationBilling.providerSubscriptionId, input.subscriptionId),
        ),
      )
      .limit(1);
    if (!owner || owner.organizationId === input.organizationId) return null;
    console.warn(
      `RevenueCat event ${input.event.id} ignored: subscription ${input.subscriptionId} moved from ${input.organizationId} to ${owner.organizationId}`,
    );
    const [claimed] = await tx
      .insert(revenuecatWebhookEvents)
      .values({
        appUserId: input.event.app_user_id,
        eventId: input.event.id,
        eventTimestamp: new Date(input.event.event_timestamp_ms),
        eventType: input.event.type,
        expirationAt:
          input.event.expiration_at_ms == null
            ? null
            : new Date(input.event.expiration_at_ms),
        organizationId: input.organizationId,
        originalTransactionId: input.event.original_transaction_id ?? null,
        outcome: "ignored",
        productId: input.event.product_id ?? null,
        purchasedAt:
          input.event.purchased_at_ms == null
            ? null
            : new Date(input.event.purchased_at_ms),
        transactionId: input.event.transaction_id ?? null,
      })
      .onConflictDoNothing({ target: revenuecatWebhookEvents.eventId })
      .returning({ id: revenuecatWebhookEvents.id });
    return claimed
      ? { reason: MOVED_SUBSCRIPTION_REASON, status: "ignored" }
      : { status: "duplicate" };
  });
}

export async function resolveLifecycleOwnershipConflict(input: {
  readonly db: ApiDatabase;
  readonly error: unknown;
  readonly event: RevenueCatWebhookEvent;
  readonly organizationId: string | null;
  readonly transition: RevenueCatBillingTransition;
}): Promise<RevenueCatWebhookOutcome | null> {
  if (!isNativeSubscriptionMoveConflict(input.error)) return null;
  const subscriptionId =
    isProviderSubscriptionOwnershipConflict(input.error) &&
    input.transition.kind === "grant"
      ? input.transition.fields.providerSubscriptionId
      : null;
  if (subscriptionId && input.organizationId) {
    const ignored = await ignoreLifecycleEventForMovedSubscription({
      db: input.db,
      event: input.event,
      organizationId: input.organizationId,
      subscriptionId,
    });
    if (ignored) return ignored;
  }
  return {
    reason: "Native subscription ownership changed concurrently",
    status: "retry",
  };
}
