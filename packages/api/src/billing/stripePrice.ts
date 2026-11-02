import {
  getSyncBillingTier,
  type SyncBillingTierId,
} from "@tearleads/validators/billing";
import { z } from "zod";
import {
  positiveIntegerSchema,
  providerFieldSchema,
  providerResponseSchema,
  providerStringSchema,
  readProviderField,
  readProviderObject,
} from "./providerPayloadSchema";
import { resolveDeps, type StripeApiDeps, stripeRequest } from "./stripeHttp";

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

/** Price fields are read one by one so a mismatch log shows each readable one. */
const priceFieldsSchema = z.looseObject({
  active: providerFieldSchema,
  currency: providerFieldSchema,
  id: providerFieldSchema,
  product: providerFieldSchema,
  recurring: providerFieldSchema,
  unit_amount: providerFieldSchema,
});

const recurringFieldsSchema = z.looseObject({
  interval: providerFieldSchema,
  interval_count: providerFieldSchema,
});

const expandedProductSchema = z.looseObject({
  id: providerStringSchema,
  active: z.boolean(),
});

/** The terms compared with the tier; each reads as null on its own. */
function readPriceTerms(price: Partial<z.output<typeof priceFieldsSchema>>) {
  const recurring = readProviderObject(recurringFieldsSchema, price.recurring);
  return {
    currency: readProviderField(providerStringSchema, price.currency),
    interval: readProviderField(providerStringSchema, recurring.interval),
    intervalCount: readProviderField(
      positiveIntegerSchema,
      recurring.interval_count,
    ),
    priceId: readProviderField(providerStringSchema, price.id),
    unitAmount: readProviderField(positiveIntegerSchema, price.unit_amount),
  };
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
  if (!providerResponseSchema.safeParse(body).success) {
    console.error("Configured Stripe catalog entry is unusable", {
      priceId: syncPriceId,
      reason: "Price lookup returned an invalid response",
      tierId,
    });
    return null;
  }
  const price = readProviderObject(priceFieldsSchema, body);
  const priceActive = readProviderField(z.boolean(), price.active);
  const { currency, interval, intervalCount, priceId, unitAmount } =
    readPriceTerms(price);
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
  const product = readProviderField(expandedProductSchema, price.product);
  if (!product) {
    console.error("Configured Stripe catalog entry is unusable", {
      priceId: syncPriceId,
      reason: "Expanded Product is missing or invalid",
      tierId,
    });
    return null;
  }
  if (!product.active) {
    console.error("Configured Stripe catalog entry is unusable", {
      priceId: syncPriceId,
      productId: product.id,
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
