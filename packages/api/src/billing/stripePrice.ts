import {
  getSyncBillingTier,
  type SyncBillingTierId,
} from "@tearleads/validators/billing";
import {
  prop,
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

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

/** Fetches and validates the configured monthly USD Price for one tier. */
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
    path: `/v1/prices/${encodeURIComponent(syncPriceId)}`,
    operation: "price lookup",
  });
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const recurring = prop(body, "recurring");
  const unitAmount = readPositiveInteger(prop(body, "unit_amount"));
  const priceId = readString(prop(body, "id"));
  const currency = readString(prop(body, "currency"));
  const interval = readString(prop(recurring, "interval"));
  const intervalCount = readPositiveInteger(prop(recurring, "interval_count"));
  if (
    priceId !== syncPriceId ||
    currency !== "usd" ||
    unitAmount !== tier.monthlyPriceUsdCents ||
    interval !== "month" ||
    intervalCount !== 1
  ) {
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
