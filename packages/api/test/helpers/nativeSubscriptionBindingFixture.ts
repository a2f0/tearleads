import { db } from "@tearleads/api-shared/postgres";
import { revenuecatWebhookEvents } from "@tearleads/api-shared/schema";

/** Seed the immutable provider identity alongside a directly seeded binding. */
export async function seedNativeSubscriptionStore(input: {
  readonly appUserId: string;
  readonly organizationId: string;
  readonly subscriptionId: string;
  readonly store: "APP_STORE" | "PLAY_STORE";
}): Promise<void> {
  await db.insert(revenuecatWebhookEvents).values({
    appUserId: input.appUserId,
    organizationId: input.organizationId,
    originalTransactionId: input.subscriptionId,
    store: input.store,
    eventId: crypto.randomUUID(),
    eventType: "INITIAL_PURCHASE",
    eventTimestamp: new Date(Date.now() - 1_000),
    outcome: "applied",
  });
}
