import type {
  RequestFailure,
  RequestResult,
  RequestResultOptions,
} from "@tearleads/api-client";
import {
  BILLING_ERROR_CODES,
  type NativeSubscriptionStore,
} from "@tearleads/validators/billing";
import type {
  OrganizationBillingHistoryResponse,
  OrganizationBillingManagementUrlResponse,
  OrganizationBillingResponse,
  OrganizationBillingStatus,
  OrganizationBillingSubscriptionSource,
  OrganizationNativePurchaseEligibilityResponse,
  StripeCancelResponse,
  StripeCheckoutIntentResponse,
  StripeCheckoutOptionsResponse,
  StripeCheckoutSessionResponse,
  StripePlanChange,
  StripePlanChangeResponse,
} from "@tearleads/validators/response";

/** Per-organization sync-billing snapshot (the server wire shape). */
export type OrganizationBilling = OrganizationBillingResponse;

/** Per-organization billing lifecycle history (the server wire shape). */
export type OrganizationBillingHistory = OrganizationBillingHistoryResponse;

/** One lifecycle event in an organization's billing history, newest first. */
export type OrganizationBillingHistoryEntry =
  OrganizationBillingHistoryResponse["entries"][number];

/** Per-organization subscription-management URL (the server wire shape). */
export type OrganizationBillingManagementUrl =
  OrganizationBillingManagementUrlResponse;

/** Server-backed, point-in-time policy decision made before native checkout. */
export type OrganizationNativePurchaseEligibility =
  OrganizationNativePurchaseEligibilityResponse;

/** Purchasable sync options for the direct Stripe checkout (the wire shape). */
export type StripeCheckoutOptions = StripeCheckoutOptionsResponse;

/**
 * The subscription started when the buyer pressed Pay, and the client secret
 * that confirms its first payment (the wire shape).
 */
export type StripeCheckoutIntent = StripeCheckoutIntentResponse;

/** The billing methods these workflows need from the api client. */
interface OrganizationBillingApi {
  readonly getOrganizationBilling: (
    organizationId: string,
  ) => Promise<OrganizationBillingResponse | null>;
  readonly getOrganizationBillingHistory: (
    organizationId: string,
  ) => Promise<OrganizationBillingHistoryResponse | null>;
  readonly getOrganizationBillingManagementUrl: (
    organizationId: string,
  ) => Promise<OrganizationBillingManagementUrlResponse | null>;
  readonly startOrganizationTrial: (
    organizationId: string,
  ) => Promise<OrganizationBillingResponse | null>;
  readonly claimNativeOrganizationSubscription: (
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => Promise<RequestResult<OrganizationBillingResponse>>;
  readonly getOrganizationNativePurchaseEligibility: (
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => Promise<OrganizationNativePurchaseEligibilityResponse | null>;
  readonly getStripeCheckoutOptions: (
    organizationId: string,
    options?: RequestResultOptions,
  ) => Promise<RequestResult<StripeCheckoutOptionsResponse>>;
  readonly createStripeCheckout: (
    organizationId: string,
    priceId: string,
    options?: RequestResultOptions,
  ) => Promise<RequestResult<StripeCheckoutIntentResponse>>;
  readonly createStripeCheckoutSession: (
    organizationId: string,
    priceId: string,
    returnUrl: string,
    options?: RequestResultOptions,
  ) => Promise<RequestResult<StripeCheckoutSessionResponse>>;
  readonly cancelStripeSubscription: (
    organizationId: string,
  ) => Promise<StripeCancelResponse | null>;
  readonly changeStripePlan: (
    organizationId: string,
    priceId: string,
    options?: RequestResultOptions,
  ) => Promise<RequestResult<StripePlanChangeResponse>>;
}

export async function loadOrganizationBilling(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "getOrganizationBilling">;
  readonly organizationId: string;
}): Promise<OrganizationBilling | null> {
  return input.apiClient.getOrganizationBilling(input.organizationId);
}

export async function loadOrganizationBillingHistory(input: {
  readonly apiClient: Pick<
    OrganizationBillingApi,
    "getOrganizationBillingHistory"
  >;
  readonly organizationId: string;
}): Promise<OrganizationBillingHistory | null> {
  return input.apiClient.getOrganizationBillingHistory(input.organizationId);
}

export async function loadOrganizationBillingManagementUrl(input: {
  readonly apiClient: Pick<
    OrganizationBillingApi,
    "getOrganizationBillingManagementUrl"
  >;
  readonly organizationId: string;
}): Promise<OrganizationBillingManagementUrl | null> {
  return input.apiClient.getOrganizationBillingManagementUrl(
    input.organizationId,
  );
}

export async function startOrganizationTrial(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "startOrganizationTrial">;
  readonly organizationId: string;
}): Promise<OrganizationBilling | null> {
  return input.apiClient.startOrganizationTrial(input.organizationId);
}

export async function claimNativeOrganizationSubscription(input: {
  readonly apiClient: Pick<
    OrganizationBillingApi,
    "claimNativeOrganizationSubscription"
  >;
  readonly organizationId: string;
  readonly store: NativeSubscriptionStore;
}): Promise<OrganizationBilling | null> {
  const result = await input.apiClient.claimNativeOrganizationSubscription(
    input.organizationId,
    input.store,
  );
  if (!result.ok) {
    result.report();
    throw Object.assign(new Error(result.message), { status: result.status });
  }
  return result.data;
}

export function checkNativePurchaseEligibility(input: {
  readonly apiClient: Pick<
    OrganizationBillingApi,
    "getOrganizationNativePurchaseEligibility"
  >;
  readonly organizationId: string;
  readonly store: NativeSubscriptionStore;
}): Promise<OrganizationNativePurchaseEligibility | null> {
  return input.apiClient.getOrganizationNativePurchaseEligibility(
    input.organizationId,
    input.store,
  );
}

export async function loadStripeCheckoutOptions(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "getStripeCheckoutOptions">;
  readonly organizationId: string;
}): Promise<StripeCheckoutOptions | null> {
  const result = await input.apiClient.getStripeCheckoutOptions(
    input.organizationId,
    { reportErrors: false },
  );
  if (!result.ok) {
    result.report();
    throw Object.assign(new Error(result.message), {
      ...(result.code === undefined ? {} : { code: result.code }),
    });
  }
  return result.data;
}

/**
 * Throws a refused checkout as an `Error` carrying the server's billing
 * `code`. `billing_checkout_plan_unavailable` is an expected outcome (the
 * caller reloads the options), so only other failures are reported to
 * diagnostics.
 */
function throwCheckoutRefusal(result: RequestFailure): never {
  if (result.code !== BILLING_ERROR_CODES.checkoutPlanUnavailable) {
    result.report();
  }
  throw Object.assign(new Error(result.message), {
    ...(result.code === undefined ? {} : { code: result.code }),
  });
}

/**
 * Starts the subscription when the buyer presses Pay, at the plan they chose.
 * A refusal throws with the server's billing `code` (see
 * {@link throwCheckoutRefusal}).
 */
export async function createStripeCheckout(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "createStripeCheckout">;
  readonly organizationId: string;
  readonly priceId: string;
}): Promise<StripeCheckoutIntent> {
  const result = await input.apiClient.createStripeCheckout(
    input.organizationId,
    input.priceId,
    { reportErrors: false },
  );
  return result.ok ? result.data : throwCheckoutRefusal(result);
}

/**
 * Opens the hosted fallback for the plan the buyer chose. A null URL means
 * the integration is unconfigured; a refusal throws with the server's billing
 * `code`.
 */
export async function createStripeCheckoutSession(input: {
  readonly apiClient: Pick<
    OrganizationBillingApi,
    "createStripeCheckoutSession"
  >;
  readonly organizationId: string;
  readonly priceId: string;
  readonly returnUrl: string;
}): Promise<StripeCheckoutSessionResponse> {
  const result = await input.apiClient.createStripeCheckoutSession(
    input.organizationId,
    input.priceId,
    input.returnUrl,
    { reportErrors: false },
  );
  return result.ok ? result.data : throwCheckoutRefusal(result);
}

export async function cancelStripeSubscription(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "cancelStripeSubscription">;
  readonly organizationId: string;
}): Promise<StripeCancelResponse | null> {
  return input.apiClient.cancelStripeSubscription(input.organizationId);
}

/**
 * Changes the active Stripe subscription to the plan with `priceId`: the
 * server charges a larger plan's prorated difference now and schedules a
 * smaller one for renewal. Null when Stripe is unconfigured. A refusal throws
 * with the server's billing `code`; a declined upgrade or a plan that cannot
 * be changed to now is an expected outcome and is not reported.
 */
export async function changeStripePlan(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "changeStripePlan">;
  readonly organizationId: string;
  readonly priceId: string;
}): Promise<StripePlanChange | null> {
  const result = await input.apiClient.changeStripePlan(
    input.organizationId,
    input.priceId,
    { reportErrors: false },
  );
  if (result.ok) {
    return result.data.change;
  }
  if (result.status === 503) {
    return null;
  }
  if (
    result.code !== BILLING_ERROR_CODES.planChangePaymentFailed &&
    result.code !== BILLING_ERROR_CODES.planChangeUnavailable
  ) {
    result.report();
  }
  throw Object.assign(new Error(result.message), {
    ...(result.code === undefined ? {} : { code: result.code }),
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Client-side projection of a billing snapshot for display and gating. */
export interface OrganizationBillingView {
  readonly status: OrganizationBillingStatus;
  /** Whether the org may sync right now (mirrors the server's organizationCanSync). */
  readonly canSync: boolean;
  /** Free, on-device only (status "local"). */
  readonly isLocal: boolean;
  /** Actively in a non-expired free trial. */
  readonly isTrialing: boolean;
  /** Active paid subscription within its current period. */
  readonly isActive: boolean;
  /** Whole days left in the trial (ceil, floored at 0); null unless trialing. */
  readonly trialDaysRemaining: number | null;
  readonly trialEndsAtMs: number | null;
  readonly currentPeriodStartsAtMs: number | null;
  readonly currentPeriodEndsAtMs: number | null;
  readonly seatCount: number;
  readonly assignedSeatCount: number;
  readonly currentUserHasSyncSeat: boolean;
  /** The organization is entitled to sync, but this identity has no assigned seat. */
  readonly syncSeatUnavailable: boolean;
  /** Scheduled tier not effective yet: a native store change, or the smaller plan a Stripe subscription renews at. */
  readonly pendingSeatCount: number | null;
  /** A retained Stripe subscription can be cancelled, including during native ownership. */
  readonly canCancelDirectly: boolean;
  /** Store of record for the bound subscription, or null when none binds. */
  readonly subscriptionSource: OrganizationBillingSubscriptionSource | null;
  /** Sync is expected but currently off (lapsed/disabled) — prompt to fix. */
  readonly needsAttention: boolean;
}

function parseIsoMs(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Resolve a billing snapshot into a display/gating view. Mirrors the server's
 * `organizationCanSync` so the client shows the same "can this org sync?" answer
 * the server enforces — the server stays the source of truth via the 402 gate;
 * this is only for presentation.
 */
export function resolveOrganizationBillingView(
  billing: OrganizationBilling,
  nowMs: number,
): OrganizationBillingView {
  const trialEndsAtMs = parseIsoMs(billing.trialEndsAt);
  const currentPeriodStartsAtMs = parseIsoMs(billing.currentPeriodStartsAt);
  const currentPeriodEndsAtMs = parseIsoMs(billing.currentPeriodEndsAt);

  const isActive =
    billing.status === "active" &&
    (currentPeriodEndsAtMs === null || currentPeriodEndsAtMs > nowMs);
  const isTrialing =
    billing.status === "trialing" &&
    trialEndsAtMs !== null &&
    trialEndsAtMs > nowMs;
  const organizationCanSync = isActive || isTrialing;
  const canSync = organizationCanSync && billing.currentUserHasSyncSeat;
  const isLocal = billing.status === "local";

  const trialDaysRemaining =
    billing.status === "trialing" && trialEndsAtMs !== null
      ? Math.max(0, Math.ceil((trialEndsAtMs - nowMs) / DAY_MS))
      : null;

  return {
    status: billing.status,
    canSync,
    isLocal,
    isTrialing,
    isActive,
    trialDaysRemaining,
    trialEndsAtMs,
    currentPeriodStartsAtMs,
    currentPeriodEndsAtMs,
    seatCount: billing.seatCount,
    assignedSeatCount: billing.assignedSeatCount,
    currentUserHasSyncSeat: billing.currentUserHasSyncSeat,
    syncSeatUnavailable: organizationCanSync && !billing.currentUserHasSyncSeat,
    pendingSeatCount: billing.pendingSeatCount,
    subscriptionSource: billing.subscriptionSource,
    canCancelDirectly: billing.canCancelDirectly,
    needsAttention: !isLocal && !canSync,
  };
}
