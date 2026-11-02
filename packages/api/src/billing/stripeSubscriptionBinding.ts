import { z } from "zod";
import {
  nonnegativeIntegerSchema,
  positiveIntegerSchema,
  providerFieldSchema,
  providerResponseSchema,
  providerStringSchema,
  readProviderField,
  readProviderObject,
  readProviderString,
  readStripeReferenceId,
  readUnixTimestamp,
} from "./providerPayloadSchema";
import {
  getSyncBillingTierForStripePrice,
  resolveDeps,
  type StripeApiDeps,
  stripeRequest,
} from "./stripeHttp";

export interface StripeSubscriptionBinding {
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  readonly currency: string | null;
  readonly customerEmail: string | null;
  readonly customerId: string | null;
  readonly interval: string | null;
  readonly intervalCount: number | null;
  readonly organizationId: string | null;
  readonly paymentMethodBillingEmail: string | null;
  readonly priceId: string | null;
  readonly seatQuantity: number | null;
  readonly status: string | null;
  readonly subscriptionItemId: string | null;
  readonly unitAmount: number | null;
  readonly userId: string | null;
}

// Every snapshot field is read on its own: one malformed field reads as null
// without hiding the others.
const subscriptionFieldsSchema = z.looseObject({
  current_period_end: providerFieldSchema,
  current_period_start: providerFieldSchema,
  customer: providerFieldSchema,
  default_payment_method: providerFieldSchema,
  metadata: providerFieldSchema,
  status: providerFieldSchema,
});

const subscriptionItemsSchema = z.looseObject({
  items: z.looseObject({ data: z.array(z.unknown()) }),
});

const itemFieldsSchema = z.looseObject({
  id: providerFieldSchema,
  price: providerFieldSchema,
  quantity: providerFieldSchema,
});

const itemPriceIdSchema = z.looseObject({
  price: z.looseObject({ id: providerStringSchema }),
});

const priceFieldsSchema = z.looseObject({
  currency: providerFieldSchema,
  id: providerFieldSchema,
  recurring: providerFieldSchema,
  unit_amount: providerFieldSchema,
});

const recurringFieldsSchema = z.looseObject({
  interval: providerFieldSchema,
  interval_count: providerFieldSchema,
});

const customerFieldsSchema = z.looseObject({ email: providerFieldSchema });

const paymentMethodEmailSchema = z.looseObject({
  billing_details: z.looseObject({ email: providerStringSchema }),
});

const metadataFieldsSchema = z.looseObject({
  orgId: providerFieldSchema,
  userId: providerFieldSchema,
});

function readItemPriceId(item: unknown): string | null {
  return readProviderField(itemPriceIdSchema, item)?.price.id ?? null;
}

function resolveSyncItem(
  items: readonly unknown[] | null,
  syncPriceIds: readonly string[],
): unknown {
  if (syncPriceIds.length === 0 || items === null) {
    return null;
  }
  const matches = items.filter((item) =>
    syncPriceIds.includes(readItemPriceId(item) ?? ""),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Reads the authoritative org binding and licensed sync item from Stripe. */
export async function getSubscriptionBinding(
  subscriptionId: string,
  deps: StripeApiDeps = {},
): Promise<StripeSubscriptionBinding | null> {
  const { fetchImpl, secretKey, syncPriceIds } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=customer&expand[]=default_payment_method`,
    operation: "subscription lookup",
  });
  if (!providerResponseSchema.safeParse(body).success) {
    return null;
  }
  const subscription = readProviderObject(subscriptionFieldsSchema, body);
  const metadata = readProviderObject(
    metadataFieldsSchema,
    subscription.metadata,
  );
  const configuredPriceIds = Object.values(syncPriceIds).filter(
    (value): value is string => Boolean(value),
  );
  const items =
    readProviderField(subscriptionItemsSchema, body)?.items.data ?? null;
  const itemValue = resolveSyncItem(items, configuredPriceIds);
  if (!itemValue && configuredPriceIds.length > 0) {
    const observedPriceIds = (items ?? [])
      .map(readItemPriceId)
      .filter((value): value is string => value !== null);
    const matchCount = observedPriceIds.filter((priceId) =>
      configuredPriceIds.includes(priceId),
    ).length;
    const problem =
      matchCount === 0
        ? "has no item matching the configured fixed-tier Prices"
        : "has multiple items matching the configured fixed-tier Prices";
    console.error(
      `Stripe subscription ${subscriptionId} ${problem}; observed: ${observedPriceIds.join(", ") || "none"}`,
    );
  }
  const item = readProviderObject(itemFieldsSchema, itemValue);
  const price = readProviderObject(priceFieldsSchema, item.price);
  const recurring = readProviderObject(recurringFieldsSchema, price.recurring);
  const priceId = readProviderString(price.id);
  const tier = getSyncBillingTierForStripePrice(priceId, deps);
  const itemQuantity = readProviderField(positiveIntegerSchema, item.quantity);
  if (tier && itemQuantity !== 1) {
    console.error(
      `Stripe subscription ${subscriptionId} has invalid quantity ${itemQuantity}; fixed-tier subscriptions require quantity 1`,
    );
  }
  return {
    billingPeriodEndsAt: readUnixTimestamp(subscription.current_period_end),
    billingPeriodStartsAt: readUnixTimestamp(subscription.current_period_start),
    currency: readProviderString(price.currency),
    customerEmail: readProviderString(
      readProviderObject(customerFieldsSchema, subscription.customer).email,
    ),
    customerId: readStripeReferenceId(subscription.customer),
    interval: readProviderString(recurring.interval),
    intervalCount: readProviderField(
      positiveIntegerSchema,
      recurring.interval_count,
    ),
    organizationId: readProviderString(metadata.orgId),
    paymentMethodBillingEmail:
      readProviderField(
        paymentMethodEmailSchema,
        subscription.default_payment_method,
      )?.billing_details.email ?? null,
    priceId,
    seatQuantity: itemQuantity === 1 ? (tier?.seatLimit ?? null) : null,
    status: readProviderString(subscription.status),
    subscriptionItemId: readProviderString(item.id),
    unitAmount: readProviderField(nonnegativeIntegerSchema, price.unit_amount),
    userId: readProviderString(metadata.userId),
  };
}
