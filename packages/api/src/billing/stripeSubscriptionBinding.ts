import {
  getSyncBillingTierForStripePrice,
  prop,
  readNonnegativeInteger,
  readPositiveInteger,
  readString,
  readUnixTimestamp,
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

function resolveSyncItem(
  body: unknown,
  syncPriceIds: readonly string[],
): unknown {
  const items = prop(prop(body, "items"), "data");
  if (syncPriceIds.length === 0 || !Array.isArray(items)) {
    return null;
  }
  const matches = items.filter((item) =>
    syncPriceIds.includes(readString(prop(prop(item, "price"), "id")) ?? ""),
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
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const metadata = prop(body, "metadata");
  const customer = prop(body, "customer");
  const paymentMethod = prop(body, "default_payment_method");
  const configuredPriceIds = Object.values(syncPriceIds).filter(
    (value): value is string => Boolean(value),
  );
  const item = resolveSyncItem(body, configuredPriceIds);
  if (!item && configuredPriceIds.length > 0) {
    const items = prop(prop(body, "items"), "data");
    const observedPriceIds = Array.isArray(items)
      ? items
          .map((candidate) => readString(prop(prop(candidate, "price"), "id")))
          .filter((value): value is string => value !== null)
      : [];
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
  const price = prop(item, "price");
  const priceId = readString(prop(price, "id"));
  const tier = getSyncBillingTierForStripePrice(priceId, deps);
  const itemQuantity = readPositiveInteger(prop(item, "quantity"));
  if (tier && itemQuantity !== 1) {
    console.error(
      `Stripe subscription ${subscriptionId} has invalid quantity ${itemQuantity}; fixed-tier subscriptions require quantity 1`,
    );
  }
  return {
    billingPeriodEndsAt: readUnixTimestamp(prop(body, "current_period_end")),
    billingPeriodStartsAt: readUnixTimestamp(
      prop(body, "current_period_start"),
    ),
    currency: readString(prop(price, "currency")),
    customerEmail: readString(prop(customer, "email")),
    customerId: readString(customer) ?? readString(prop(customer, "id")),
    interval: readString(prop(prop(price, "recurring"), "interval")),
    intervalCount: readPositiveInteger(
      prop(prop(price, "recurring"), "interval_count"),
    ),
    organizationId: readString(prop(metadata, "orgId")),
    paymentMethodBillingEmail: readString(
      prop(prop(paymentMethod, "billing_details"), "email"),
    ),
    priceId,
    seatQuantity: itemQuantity === 1 ? (tier?.seatLimit ?? null) : null,
    status: readString(prop(body, "status")),
    subscriptionItemId: readString(prop(item, "id")),
    unitAmount: readNonnegativeInteger(prop(price, "unit_amount")),
    userId: readString(prop(metadata, "userId")),
  };
}
