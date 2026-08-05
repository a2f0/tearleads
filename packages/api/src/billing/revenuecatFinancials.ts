import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";

const POSTGRES_INTEGER_MIN = -2_147_483_648;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

interface RevenueCatFinancialAuditFields {
  readonly currency: string | null;
  readonly environment: string | null;
  readonly periodType: string | null;
  readonly priceInPurchasedCurrencyMinor: number | null;
}

function normalizeProviderValue(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function currencyFractionDigits(currency: string): number | null {
  try {
    if (
      typeof Intl.supportedValuesOf === "function" &&
      !Intl.supportedValuesOf("currency").includes(currency)
    ) {
      return null;
    }
    return (
      new Intl.NumberFormat("en", {
        currency,
        style: "currency",
      }).resolvedOptions().maximumFractionDigits ?? null
    );
  } catch {
    return null;
  }
}

function toCurrencyMinorUnits(
  price: number | null | undefined,
  currency: string | null,
): number | null {
  if (price == null || !Number.isFinite(price) || currency === null) {
    return null;
  }
  const fractionDigits = currencyFractionDigits(currency);
  if (fractionDigits === null) {
    return null;
  }
  const minorAmount = Math.round(price * 10 ** fractionDigits);
  return Number.isSafeInteger(minorAmount) &&
    minorAmount >= POSTGRES_INTEGER_MIN &&
    minorAmount <= POSTGRES_INTEGER_MAX
    ? minorAmount
    : null;
}

/** Normalizes RevenueCat's purchased-currency transaction facts for audit. */
export function resolveRevenueCatFinancialAuditFields(
  event: Pick<
    RevenueCatWebhookEvent,
    "currency" | "environment" | "period_type" | "price_in_purchased_currency"
  >,
): RevenueCatFinancialAuditFields {
  const currency = normalizeProviderValue(event.currency);
  return {
    currency,
    environment: normalizeProviderValue(event.environment),
    periodType: normalizeProviderValue(event.period_type),
    priceInPurchasedCurrencyMinor: toCurrencyMinorUnits(
      event.price_in_purchased_currency,
      currency,
    ),
  };
}
