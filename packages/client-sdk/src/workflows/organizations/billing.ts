import type {
  RequestResult,
  RequestResultOptions,
} from "@tearleads/api-client";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import type {
  OrganizationBillingHistoryResponse,
  OrganizationBillingManagementUrlResponse,
  OrganizationBillingResponse,
  OrganizationBillingStatus,
  StripeCancelResponse,
  StripeCheckoutIntentResponse,
  StripeCheckoutOptionsResponse,
  StripeCheckoutSessionResponse,
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

/** Purchasable sync options for the direct Stripe checkout (the wire shape). */
export type StripeCheckoutOptions = StripeCheckoutOptionsResponse;

/** What the Payment Element needs to confirm a purchase (the wire shape). */
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
  ) => Promise<OrganizationBillingResponse | null>;
  readonly getStripeCheckoutOptions: (
    organizationId: string,
    options?: RequestResultOptions,
  ) => Promise<RequestResult<StripeCheckoutOptionsResponse>>;
  readonly createStripeCheckout: (
    organizationId: string,
  ) => Promise<StripeCheckoutIntentResponse | null>;
  readonly createStripeCheckoutSession: (
    organizationId: string,
    returnUrl: string,
  ) => Promise<StripeCheckoutSessionResponse | null>;
  readonly cancelStripeSubscription: (
    organizationId: string,
  ) => Promise<StripeCancelResponse | null>;
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
  return input.apiClient.claimNativeOrganizationSubscription(
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

export async function createStripeCheckout(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "createStripeCheckout">;
  readonly organizationId: string;
}): Promise<StripeCheckoutIntent | null> {
  return input.apiClient.createStripeCheckout(input.organizationId);
}

export async function createStripeCheckoutSession(input: {
  readonly apiClient: Pick<
    OrganizationBillingApi,
    "createStripeCheckoutSession"
  >;
  readonly organizationId: string;
  readonly returnUrl: string;
}): Promise<StripeCheckoutSessionResponse | null> {
  return input.apiClient.createStripeCheckoutSession(
    input.organizationId,
    input.returnUrl,
  );
}

export async function cancelStripeSubscription(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "cancelStripeSubscription">;
  readonly organizationId: string;
}): Promise<StripeCancelResponse | null> {
  return input.apiClient.cancelStripeSubscription(input.organizationId);
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
  /** Sync is expected but currently off (lapsed/disabled/past_due) — prompt to fix. */
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
  const canSync = isActive || isTrialing;
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
    needsAttention: !isLocal && !canSync,
  };
}
