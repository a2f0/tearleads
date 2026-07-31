/**
 * Clipboard-safe telemetry for the provider-hosted purchase flow.
 *
 * Billing failures cross native bridges as untrusted plain objects whose free
 * text can contain receipt or account details. These helpers emit only a
 * closed RevenueCat error vocabulary plus a numeric code extracted from known
 * Apple error domains. The System Monitor validates the complete line again
 * before copying it into a support report.
 */

type BillingPurchaseStage =
  | "aborted"
  | "cancelled"
  | "identified"
  | "provider-started"
  | "started";

const PURCHASE_FAILURE_CODES: ReadonlyArray<readonly [string, string]> = [
  ["0", "unknown"],
  ["1", "purchase-cancelled"],
  ["2", "store-problem"],
  ["3", "purchase-not-allowed"],
  ["4", "purchase-invalid"],
  ["5", "product-unavailable"],
  ["6", "product-already-purchased"],
  ["7", "receipt-already-in-use"],
  ["8", "invalid-receipt"],
  ["9", "missing-receipt-file"],
  ["10", "network"],
  ["11", "invalid-credentials"],
  ["12", "unexpected-backend-response"],
  ["13", "receipt-used-by-other-subscriber"],
  ["14", "invalid-app-user-id"],
  ["15", "operation-in-progress"],
  ["16", "unknown-backend"],
  ["17", "invalid-apple-subscription-key"],
  ["18", "ineligible"],
  ["19", "insufficient-permissions"],
  ["20", "payment-pending"],
  ["21", "invalid-subscriber-attributes"],
  ["22", "anonymous-log-out"],
  ["23", "configuration"],
  ["24", "unsupported"],
  ["25", "empty-subscriber-attributes"],
  ["26", "discount-missing-identifier"],
  ["28", "discount-missing-group-identifier"],
  ["29", "customer-info"],
  ["30", "system-info"],
  ["31", "refund-request"],
  ["32", "product-request-timeout"],
  ["33", "api-endpoint-blocked"],
  ["34", "invalid-promotional-offer"],
  ["35", "offline"],
  ["42", "test-store-simulated-purchase"],
];

const PURCHASE_FAILURE_CODE_BY_VALUE = new Map(PURCHASE_FAILURE_CODES);
const PURCHASE_FAILURE_CODE_FRAGMENT = [
  ...PURCHASE_FAILURE_CODES.map(([, name]) => name),
  "other",
].join("|");

const NATIVE_ERROR_DOMAINS: ReadonlyArray<readonly [string, string]> = [
  ["ASDErrorDomain", "asd"],
  ["AMSErrorDomain", "ams"],
  ["StoreKitErrorDomain", "storekit"],
  ["SKErrorDomain", "sk"],
  ["NSURLErrorDomain", "url"],
];
const NATIVE_ERROR_DOMAIN_FRAGMENT = NATIVE_ERROR_DOMAINS.map(
  ([, name]) => name,
).join("|");

export const BILLING_PURCHASE_TRACE_FRAGMENT = `(?:${[
  "billing purchase stage=(?:started|identified|provider-started|aborted|cancelled)",
  "billing purchase stage=(?:succeeded|late-succeeded) entitlement=(?:active|inactive)",
  `billing purchase stage=(?:failed|late-failed) code=(?:${PURCHASE_FAILURE_CODE_FRAGMENT}) native=(?:none|(?:${NATIVE_ERROR_DOMAIN_FRAGMENT}):-?\\d{1,10}) userCancelled=(?:true|false|unknown)`,
]
  .map((alternative) => `(?:${alternative})`)
  .join("|")})`;

export const BILLING_PURCHASE_TRACE_PATTERN = new RegExp(
  `^(?:${BILLING_PURCHASE_TRACE_FRAGMENT})$`,
  "u",
);

export function formatBillingPurchaseStage(
  stage: BillingPurchaseStage,
): string {
  return `billing purchase stage=${stage}`;
}

export function formatBillingPurchaseSuccess(
  entitlementActive: boolean,
  late = false,
): string {
  return `billing purchase stage=${late ? "late-succeeded" : "succeeded"} entitlement=${entitlementActive ? "active" : "inactive"}`;
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" || typeof error.code === "number"
    ? String(error.code)
    : undefined;
}

function readUnderlyingErrorMessage(error: unknown): string | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("underlyingErrorMessage" in error)
  ) {
    return undefined;
  }
  return typeof error.underlyingErrorMessage === "string"
    ? error.underlyingErrorMessage
    : undefined;
}

function readUserCancelled(error: unknown): "false" | "true" | "unknown" {
  if (
    typeof error !== "object" ||
    error === null ||
    !("userCancelled" in error) ||
    typeof error.userCancelled !== "boolean"
  ) {
    return "unknown";
  }
  return error.userCancelled ? "true" : "false";
}

function classifyNativeError(error: unknown): string {
  const message = readUnderlyingErrorMessage(error);
  if (!message) {
    return "none";
  }
  for (const [domain, safeName] of NATIVE_ERROR_DOMAINS) {
    const match = new RegExp(
      `${domain}[^0-9-]{0,40}Code=(-?\\d{1,10})(?!\\d)`,
      "u",
    ).exec(message);
    if (match?.[1]) {
      return `${safeName}:${match[1]}`;
    }
  }
  return "none";
}

export function formatBillingPurchaseFailure(
  error: unknown,
  late = false,
): string {
  const code =
    PURCHASE_FAILURE_CODE_BY_VALUE.get(readErrorCode(error) ?? "") ?? "other";
  return `billing purchase stage=${late ? "late-failed" : "failed"} code=${code} native=${classifyNativeError(error)} userCancelled=${readUserCancelled(error)}`;
}
