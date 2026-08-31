import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { revenuecatWebhookEvents } from "@symcrypt/api-shared/schema";
import {
  getSyncBillingTierForNativeProduct,
  type NativeSubscriptionStore,
} from "@symcrypt/validators/billing";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { LockedBillingIdentity } from "./revenuecatStripeResolution";

type NativeBindingIdentity = Pick<
  LockedBillingIdentity,
  | "provider"
  | "providerCustomerId"
  | "providerProductId"
  | "providerSubscriptionId"
>;

const REVENUECAT_STORE_BY_NATIVE_STORE: Record<
  NativeSubscriptionStore,
  string
> = {
  app_store: "APP_STORE",
  play_store: "PLAY_STORE",
  test_store: "TEST_STORE",
};

export function revenueCatStoreForNativeStore(
  store: NativeSubscriptionStore,
): string {
  return REVENUECAT_STORE_BY_NATIVE_STORE[store];
}

/** Reads the durable store identity for the subscription in the locked row. */
export async function resolvePersistedNativeSubscriptionStore(input: {
  readonly billing: NativeBindingIdentity;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<string | null> {
  const { providerCustomerId, providerSubscriptionId } = input.billing;
  if (!providerCustomerId || !providerSubscriptionId) return null;
  const [event] = await input.executor
    .select({ store: revenuecatWebhookEvents.store })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.organizationId, input.organizationId),
        eq(revenuecatWebhookEvents.outcome, "applied"),
        eq(revenuecatWebhookEvents.appUserId, providerCustomerId),
        or(
          eq(
            revenuecatWebhookEvents.originalTransactionId,
            providerSubscriptionId,
          ),
          eq(revenuecatWebhookEvents.transactionId, providerSubscriptionId),
        ),
      ),
    )
    .orderBy(
      desc(revenuecatWebhookEvents.eventTimestamp),
      desc(revenuecatWebhookEvents.createdAt),
      desc(revenuecatWebhookEvents.id),
    )
    .limit(1);
  return event?.store?.toUpperCase() ?? null;
}

/** Play plan changes can replace the purchase token before the next grant. */
async function hasAcceptedPlayReplacement(input: {
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<boolean> {
  const replacementId = input.event.original_transaction_id;
  if (!replacementId || input.event.store?.toUpperCase() !== "PLAY_STORE") {
    return false;
  }
  const [change] = await input.executor
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.organizationId, input.organizationId),
        eq(revenuecatWebhookEvents.eventType, "PRODUCT_CHANGE"),
        eq(revenuecatWebhookEvents.appUserId, input.event.app_user_id),
        eq(revenuecatWebhookEvents.store, "PLAY_STORE"),
        eq(revenuecatWebhookEvents.originalTransactionId, replacementId),
        or(
          and(
            eq(revenuecatWebhookEvents.outcome, "applied"),
            input.event.product_id
              ? eq(revenuecatWebhookEvents.productId, input.event.product_id)
              : undefined,
          ),
          and(
            eq(revenuecatWebhookEvents.outcome, "ignored"),
            isNull(revenuecatWebhookEvents.productId),
          ),
        ),
      ),
    )
    .limit(1);
  return change !== undefined;
}

/** Matches an event to the persisted native binding or its accepted Play chain. */
export async function matchesLockedNativeSubscription(input: {
  readonly billing: NativeBindingIdentity;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<boolean> {
  if (!(await matchesLockedNativeStore(input))) return false;
  if (!input.event.original_transaction_id) return true;
  if (
    input.billing.providerSubscriptionId === input.event.original_transaction_id
  ) {
    return true;
  }
  return hasAcceptedPlayReplacement(input);
}

/** Confirms buyer, configured product, and durable store without token equality. */
export async function matchesLockedNativeStore(input: {
  readonly billing: NativeBindingIdentity;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<boolean> {
  const persistedStore = await resolvePersistedNativeSubscriptionStore(input);
  return Boolean(
    input.billing.provider === "revenuecat" &&
      input.billing.providerCustomerId === input.event.app_user_id &&
      input.billing.providerSubscriptionId &&
      getSyncBillingTierForNativeProduct(input.billing.providerProductId) &&
      persistedStore &&
      input.event.store?.toUpperCase() === persistedStore,
  );
}
