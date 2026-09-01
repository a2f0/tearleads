import {
  getSyncBillingTier,
  type SyncBillingTierId,
} from "@symcrypt/validators/billing";
import {
  prop,
  readPositiveInteger,
  readString,
  resolveDeps,
  type StripeApiDeps,
  stripeRequest,
} from "./stripeHttp";

/** The configured sync subscription price shaped for client display. */
export interface StripeSyncOption {
  readonly tierId: SyncBillingTierId;
  readonly seatLimit: number;
  readonly priceId: string;
  readonly productName: string;
  readonly currency: string;
  /** Amount in the currency's minor unit (e.g. cents), as Stripe reports it. */
  readonly unitAmount: number | null;
  /** Billing interval (`month`/`year`…), null for a non-recurring price. */
  readonly interval: string | null;
  /** Number of intervals in one billing period; null when Stripe omits it. */
  readonly intervalCount: number | null;
}

/** Fetches and validates the active monthly USD Price and Product for one tier. */
export async function getStripeSyncOption(
  tierId: SyncBillingTierId,
  deps: StripeApiDeps = {},
): Promise<StripeSyncOption | null> {
  const { fetchImpl, secretKey, syncPriceIds } = resolveDeps(deps);
  const syncPriceId = syncPriceIds[tierId];
  if (!secretKey || !syncPriceId) {
    return null;
  }
  const tier = getSyncBillingTier(tierId);
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/prices/${encodeURIComponent(syncPriceId)}?expand[]=product`,
    operation: "price and product lookup",
  });
  if (typeof body !== "object" || body === null) {
    console.error("Configured Stripe catalog entry is unusable", {
      priceId: syncPriceId,
      reason: "Price lookup returned an invalid response",
      tierId,
    });
    return null;
  }
  const recurring = prop(body, "recurring");
  const unitAmount = readPositiveInteger(prop(body, "unit_amount"));
  const priceId = readString(prop(body, "id"));
  const priceActive = prop(body, "active");
  const currency = readString(prop(body, "currency"));
  const interval = readString(prop(recurring, "interval"));
  const intervalCount = readPositiveInteger(prop(recurring, "interval_count"));
  if (priceActive !== true) {
    console.error("Configured Stripe catalog entry is unusable", {
      priceId: syncPriceId,
      reason:
        priceActive === false
          ? "Price is inactive"
          : "Price active state is missing or invalid",
      tierId,
    });
    return null;
  }
  const product = prop(body, "product");
  const productId = readString(prop(product, "id"));
  const productActive = prop(product, "active");
  if (!productId || typeof productActive !== "boolean") {
    console.error("Configured Stripe catalog entry is unusable", {
      priceId: syncPriceId,
      reason: "Expanded Product is missing or invalid",
      tierId,
    });
    return null;
  }
  if (!productActive) {
    console.error("Configured Stripe catalog entry is unusable", {
      priceId: syncPriceId,
      productId,
      reason: "Product is inactive",
      tierId,
    });
    return null;
  }
  if (
    priceId !== syncPriceId ||
    currency !== "usd" ||
    unitAmount !== tier.monthlyPriceUsdCents ||
    interval !== "month" ||
    intervalCount !== 1
  ) {
    console.error("Configured Stripe Price does not match its billing tier", {
      actual: { currency, interval, intervalCount, priceId, unitAmount },
      expected: {
        currency: "usd",
        interval: "month",
        intervalCount: 1,
        priceId: syncPriceId,
        unitAmount: tier.monthlyPriceUsdCents,
      },
      tierId,
    });
    return null;
  }
  return {
    tierId,
    seatLimit: tier.seatLimit,
    priceId,
    productName: tier.title,
    currency,
    unitAmount,
    interval,
    intervalCount,
  };
}
