import type {
  OrganizationBillingHistoryResponse,
  OrganizationBillingManagementUrlResponse,
  OrganizationBillingResponse,
  OrganizationBillingStatus,
  StripeCheckoutIntentResponse,
  StripeCheckoutOptionsResponse,
  StripePortalResponse,
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

/** The organization's Stripe Billing Portal link (the wire shape). */
export type StripePortal = StripePortalResponse;

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
  readonly getStripeCheckoutOptions: () => Promise<StripeCheckoutOptionsResponse | null>;
  readonly createStripeCheckout: (
    organizationId: string,
  ) => Promise<StripeCheckoutIntentResponse | null>;
  readonly createStripePortalUrl: (
    organizationId: string,
    returnUrl: string,
  ) => Promise<StripePortalResponse | null>;
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

export async function loadStripeCheckoutOptions(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "getStripeCheckoutOptions">;
}): Promise<StripeCheckoutOptions | null> {
  return input.apiClient.getStripeCheckoutOptions();
}

export async function createStripeCheckout(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "createStripeCheckout">;
  readonly organizationId: string;
}): Promise<StripeCheckoutIntent | null> {
  return input.apiClient.createStripeCheckout(input.organizationId);
}

export async function createStripePortalUrl(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "createStripePortalUrl">;
  readonly organizationId: string;
  readonly returnUrl: string;
}): Promise<StripePortal | null> {
  return input.apiClient.createStripePortalUrl(
    input.organizationId,
    input.returnUrl,
  );
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
