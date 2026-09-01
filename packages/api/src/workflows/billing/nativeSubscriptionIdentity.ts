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

const NATIVE_REVENUECAT_STORES = new Set(
  Object.values(REVENUECAT_STORE_BY_NATIVE_STORE),
);

const TOKENLESS_NATIVE_GRANT_CONTINUATION_EVENT_TYPES: ReadonlySet<string> =
  new Set([
    "RENEWAL",
    "SUBSCRIPTION_EXTENDED",
    "TEMPORARY_ENTITLEMENT_GRANT",
    "UNCANCELLATION",
  ]);

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
export async function hasAcceptedPlayReplacement(input: {
  readonly appUserId: string;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly productId: string | null;
  readonly store: string | null;
  readonly subscriptionId: string | null;
}): Promise<boolean> {
  if (!input.subscriptionId || input.store?.toUpperCase() !== "PLAY_STORE") {
    return false;
  }
  const [change] = await input.executor
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.organizationId, input.organizationId),
        eq(revenuecatWebhookEvents.eventType, "PRODUCT_CHANGE"),
        eq(revenuecatWebhookEvents.appUserId, input.appUserId),
        eq(revenuecatWebhookEvents.store, "PLAY_STORE"),
        eq(revenuecatWebhookEvents.originalTransactionId, input.subscriptionId),
        or(
          and(
            eq(revenuecatWebhookEvents.outcome, "applied"),
            input.productId
              ? eq(revenuecatWebhookEvents.productId, input.productId)
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
  if (!input.event.original_transaction_id) {
    // Product-bearing grants can replace the durable binding below. Without a
    // subscription token they may continue only the same product on the one
    // store-bound chain selected by routing. Purchases and destructive events
    // must still provide the exact immutable subscription identity.
    return (
      !input.event.product_id ||
      (TOKENLESS_NATIVE_GRANT_CONTINUATION_EVENT_TYPES.has(input.event.type) &&
        input.billing.providerProductId === input.event.product_id)
    );
  }
  if (
    input.billing.providerSubscriptionId === input.event.original_transaction_id
  ) {
    return true;
  }
  return hasAcceptedPlayReplacement({
    appUserId: input.event.app_user_id,
    executor: input.executor,
    organizationId: input.organizationId,
    productId: input.event.product_id ?? null,
    store: input.event.store ?? null,
    subscriptionId: input.event.original_transaction_id ?? null,
  });
}

/** Confirms buyer, configured product, and durable store without token equality. */
export async function matchesLockedNativeStore(input: {
  readonly billing: NativeBindingIdentity;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<boolean> {
  const eventStore = input.event.store?.toUpperCase();
  const matchesBindingIdentity = Boolean(
    input.billing.provider === "revenuecat" &&
      input.billing.providerCustomerId === input.event.app_user_id &&
      input.billing.providerSubscriptionId &&
      getSyncBillingTierForNativeProduct(input.billing.providerProductId) &&
      eventStore &&
      NATIVE_REVENUECAT_STORES.has(eventStore),
  );
  if (!matchesBindingIdentity) return false;
  const persistedStore = await resolvePersistedNativeSubscriptionStore(input);
  if (persistedStore) return eventStore === persistedStore;
  // Pre-audit bindings have no durable store row to consult. Their exact token,
  // buyer, configured product, and native event store still form a safe legacy
  // identity; a different token continues to fail closed.
  return (
    input.event.original_transaction_id === input.billing.providerSubscriptionId
  );
}
