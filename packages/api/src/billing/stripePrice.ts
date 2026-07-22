import {
  prop,
  readString,
  resolveDeps,
  type StripeApiDeps,
  stripeRequest,
} from "./stripeHttp";

/** The configured sync subscription price shaped for client display. */
export interface StripeSyncOption {
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

/** Fetches the configured sync price with its product expanded. */
export async function getStripeSyncOption(
  deps: StripeApiDeps = {},
): Promise<StripeSyncOption | null> {
  const { fetchImpl, secretKey, syncPriceId } = resolveDeps(deps);
  if (!secretKey || !syncPriceId) {
    return null;
  }
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/prices/${encodeURIComponent(syncPriceId)}?expand[]=product`,
    operation: "price lookup",
  });
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const recurring = prop(body, "recurring");
  const unitAmount = prop(body, "unit_amount");
  return {
    priceId: readString(prop(body, "id")) ?? syncPriceId,
    productName: readString(prop(prop(body, "product"), "name")) ?? "Sync",
    currency: readString(prop(body, "currency")) ?? "usd",
    unitAmount: typeof unitAmount === "number" ? unitAmount : null,
    interval: readString(prop(recurring, "interval")),
    intervalCount: readPositiveInteger(prop(recurring, "interval_count")),
  };
}
