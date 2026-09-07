const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

// Stripe's API represents both currencies with two decimal places even though
// cash amounts in them do not use fractional units. The amount must end in 00.
const STRIPE_TWO_DECIMAL_SPECIAL_CASES = new Set(["ISK", "UGX"]);
const KNOWN_CURRENCY_CACHE = new Map<string, boolean>();

function normalizeCurrency(currency: string | null): string | null {
  const currencyCode = currency?.trim().toUpperCase();
  return currencyCode ? currencyCode : null;
}

function isValidMinorAmount(amount: number | null): amount is number {
  return amount !== null && Number.isSafeInteger(amount) && amount >= 0;
}

/** Whether this runtime recognizes the code as an ISO currency. */
function isKnownCurrency(currencyCode: string): boolean {
  const cached = KNOWN_CURRENCY_CACHE.get(currencyCode);
  if (cached !== undefined) {
    return cached;
  }
  let known = false;
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      known = Intl.supportedValuesOf("currency").includes(currencyCode);
    } catch {
      known = false;
    }
  } else if (typeof Intl.DisplayNames === "function") {
    try {
      const displayNames = new Intl.DisplayNames(["en"], {
        type: "currency",
        fallback: "none",
      });
      known = displayNames.of(currencyCode) !== undefined;
    } catch {
      known = false;
    }
  }
  KNOWN_CURRENCY_CACHE.set(currencyCode, known);
  return known;
}

function stripeFractionDigits(currencyCode: string): number {
  if (STRIPE_TWO_DECIMAL_SPECIAL_CASES.has(currencyCode)) {
    return 2;
  }
  // Stripe API amounts are two-decimal unless Stripe lists the currency as
  // zero-decimal. Do not substitute Intl's ISO exponent (for example, KWD is
  // three-decimal in Intl but two-decimal in Stripe payment requests).
  // https://docs.stripe.com/currencies#minor-units-in-api-amounts
  return STRIPE_ZERO_DECIMAL_CURRENCIES.has(currencyCode) ? 0 : 2;
}

function isoFractionDigits(currencyCode: string): number {
  return (
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function formatKnownCurrency(
  minorAmount: number,
  currencyCode: string,
  fractionDigits: number,
): string {
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return formatter.format(minorAmount / 10 ** fractionDigits);
}

/** Safely formats a Stripe amount expressed in API minor units. */
export function formatBillingAmount(
  minorAmount: number | null,
  currency: string | null,
): string {
  if (!isValidMinorAmount(minorAmount)) {
    return "";
  }
  const currencyCode = normalizeCurrency(currency);
  if (currencyCode === null) {
    return "";
  }
  if (!isKnownCurrency(currencyCode)) {
    return `${minorAmount} ${currencyCode} minor units`;
  }
  return formatKnownCurrency(
    minorAmount,
    currencyCode,
    stripeFractionDigits(currencyCode),
  );
}

/** Formats the exact paid total reported by the provider. */
export function formatTotalAmount(
  totalAmount: number | null,
  currency: string | null,
  provider: "internal" | "revenuecat" | "stripe",
): string {
  if (!isValidMinorAmount(totalAmount)) {
    return "";
  }
  const currencyCode = normalizeCurrency(currency);
  if (currencyCode === null) {
    return `${totalAmount} minor units (currency unavailable)`;
  }
  if (!isKnownCurrency(currencyCode)) {
    return `${totalAmount} ${currencyCode} minor units`;
  }
  const fractionDigits =
    provider === "revenuecat"
      ? isoFractionDigits(currencyCode)
      : stripeFractionDigits(currencyCode);
  return formatKnownCurrency(totalAmount, currencyCode, fractionDigits);
}

/** Formats a recurring fixed-tier price reported in Stripe API minor units. */
export function formatPrice(
  unitAmount: number | null,
  currency: string | null,
  interval: string | null,
  intervalCount: number | null,
): string {
  const amount = formatBillingAmount(unitAmount, currency);
  if (amount.length === 0) {
    return "";
  }
  if (interval === null) {
    return amount;
  }
  if (
    intervalCount === null ||
    !Number.isSafeInteger(intervalCount) ||
    intervalCount < 1
  ) {
    return `${amount} (billing cadence unavailable)`;
  }
  return intervalCount === 1
    ? `${amount}/${interval}`
    : `${amount}/every ${intervalCount} ${interval}s`;
}
