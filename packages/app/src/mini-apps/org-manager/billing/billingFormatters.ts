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

function normalizeCurrency(currency: string | null): string | null {
  const currencyCode = currency?.trim().toUpperCase();
  return currencyCode ? currencyCode : null;
}

function isValidMinorAmount(amount: number | null): amount is number {
  return amount !== null && Number.isSafeInteger(amount) && amount >= 0;
}

/** Whether this runtime recognizes the code as an ISO currency. */
function isKnownCurrency(currencyCode: string): boolean {
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      return Intl.supportedValuesOf("currency").includes(currencyCode);
    } catch {
      return false;
    }
  }
  // Older WebViews lack supportedValuesOf. Their NumberFormat constructor is
  // still the best available capability probe and preserves ordinary prices.
  try {
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    });
    return true;
  } catch {
    return false;
  }
}

function stripeFractionDigits(currencyCode: string): number {
  if (STRIPE_TWO_DECIMAL_SPECIAL_CASES.has(currencyCode)) {
    return 2;
  }
  return STRIPE_ZERO_DECIMAL_CURRENCIES.has(currencyCode) ? 0 : 2;
}

function formatKnownCurrency(
  minorAmount: number,
  currencyCode: string,
): string {
  const fractionDigits = stripeFractionDigits(currencyCode);
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
  return formatKnownCurrency(minorAmount, currencyCode);
}

/** Formats the exact paid total reported by the provider. */
export function formatTotalAmount(
  totalAmount: number | null,
  currency: string | null,
): string {
  if (!isValidMinorAmount(totalAmount)) {
    return "";
  }
  if (normalizeCurrency(currency) === null) {
    return `${totalAmount} minor units (currency unavailable)`;
  }
  return formatBillingAmount(totalAmount, currency);
}

/** Formats a recurring per-seat rate reported in Stripe API minor units. */
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
    return `${amount}/seat`;
  }
  if (
    intervalCount === null ||
    !Number.isSafeInteger(intervalCount) ||
    intervalCount < 1
  ) {
    return `${amount}/seat (billing cadence unavailable)`;
  }
  return intervalCount === 1
    ? `${amount}/seat/${interval}`
    : `${amount}/seat/every ${intervalCount} ${interval}s`;
}
