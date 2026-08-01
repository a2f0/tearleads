import {
  getSyncBillingTierForStripePrice,
  prop,
  readString,
  resolveDeps,
  type StripeApiDeps,
  stripeRequest,
} from "./stripeHttp";

export interface StripeSubscriptionBinding {
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  readonly currency: string | null;
  readonly customerId: string | null;
  readonly interval: string | null;
  readonly intervalCount: number | null;
  readonly organizationId: string | null;
  readonly priceId: string | null;
  readonly seatQuantity: number | null;
  readonly status: string | null;
  readonly subscriptionItemId: string | null;
  readonly unitAmount: number | null;
  readonly userId: string | null;
}

function readPositiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 1
    ? Number(value)
    : null;
}

function readNonnegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}

function readUnixTimestamp(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
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
    path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    operation: "subscription lookup",
  });
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const metadata = prop(body, "metadata");
  const customer = prop(body, "customer");
  const item = resolveSyncItem(
    body,
    Object.values(syncPriceIds).filter((value): value is string =>
      Boolean(value),
    ),
  );
  const price = prop(item, "price");
  const priceId = readString(prop(price, "id"));
  const tier = getSyncBillingTierForStripePrice(priceId, deps);
  const itemQuantity = readPositiveInteger(prop(item, "quantity"));
  if (tier && itemQuantity !== null && itemQuantity !== 1) {
    console.error(
      `Stripe subscription ${subscriptionId} uses legacy quantity ${itemQuantity}; fixed-tier subscriptions require quantity 1`,
    );
  }
  return {
    billingPeriodEndsAt: readUnixTimestamp(prop(body, "current_period_end")),
    billingPeriodStartsAt: readUnixTimestamp(
      prop(body, "current_period_start"),
    ),
    currency: readString(prop(price, "currency")),
    customerId: readString(customer) ?? readString(prop(customer, "id")),
    interval: readString(prop(prop(price, "recurring"), "interval")),
    intervalCount: readPositiveInteger(
      prop(prop(price, "recurring"), "interval_count"),
    ),
    organizationId: readString(prop(metadata, "orgId")),
    priceId,
    seatQuantity: tier?.seatLimit ?? null,
    status: readString(prop(body, "status")),
    subscriptionItemId: readString(prop(item, "id")),
    unitAmount: readNonnegativeInteger(prop(price, "unit_amount")),
    userId: readString(prop(metadata, "userId")),
  };
}
