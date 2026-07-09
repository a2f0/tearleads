import type {
  OrganizationBillingResponse,
  OrganizationBillingStatus,
} from "@tearleads/validators/response";

/** Per-organization sync-billing snapshot (the server wire shape). */
export type OrganizationBilling = OrganizationBillingResponse;

/** The billing methods these workflows need from the api client. */
interface OrganizationBillingApi {
  readonly getOrganizationBilling: (
    organizationId: string,
  ) => Promise<OrganizationBillingResponse | null>;
  readonly startOrganizationTrial: (
    organizationId: string,
  ) => Promise<OrganizationBillingResponse | null>;
}

export async function loadOrganizationBilling(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "getOrganizationBilling">;
  readonly organizationId: string;
}): Promise<OrganizationBilling | null> {
  return input.apiClient.getOrganizationBilling(input.organizationId);
}

export async function startOrganizationTrial(input: {
  readonly apiClient: Pick<OrganizationBillingApi, "startOrganizationTrial">;
  readonly organizationId: string;
}): Promise<OrganizationBilling | null> {
  return input.apiClient.startOrganizationTrial(input.organizationId);
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
