import {
  prop,
  readString,
  resolveDeps,
  type StripeApiDeps,
  stripeRequest,
} from "./stripeHttp";

export interface StripeSubscriptionBinding {
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  readonly customerId: string | null;
  readonly organizationId: string | null;
  readonly priceId: string | null;
  readonly seatQuantity: number | null;
  readonly status: string | null;
  readonly subscriptionItemId: string | null;
  readonly userId: string | null;
}

function readPositiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 1
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

function resolveSyncItem(body: unknown, syncPriceId: string | null): unknown {
  const items = prop(prop(body, "items"), "data");
  if (!syncPriceId || !Array.isArray(items)) {
    return null;
  }
  const matches = items.filter(
    (item) => readString(prop(prop(item, "price"), "id")) === syncPriceId,
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Reads the authoritative org binding and licensed sync item from Stripe. */
export async function getSubscriptionBinding(
  subscriptionId: string,
  deps: StripeApiDeps = {},
): Promise<StripeSubscriptionBinding | null> {
  const { fetchImpl, secretKey, syncPriceId } = resolveDeps(deps);
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
  const item = resolveSyncItem(body, syncPriceId);
  return {
    billingPeriodEndsAt: readUnixTimestamp(prop(body, "current_period_end")),
    billingPeriodStartsAt: readUnixTimestamp(
      prop(body, "current_period_start"),
    ),
    customerId: readString(customer) ?? readString(prop(customer, "id")),
    organizationId: readString(prop(metadata, "orgId")),
    priceId: readString(prop(prop(item, "price"), "id")),
    seatQuantity: readPositiveInteger(prop(item, "quantity")),
    status: readString(prop(body, "status")),
    subscriptionItemId: readString(prop(item, "id")),
    userId: readString(prop(metadata, "userId")),
  };
}
