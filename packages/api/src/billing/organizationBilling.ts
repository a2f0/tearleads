import type {
  OrganizationBillingProvider,
  OrganizationBillingStatus,
} from "@tearleads/api-shared/schema";
import type {
  OrganizationBillingHistoryResponse,
  OrganizationBillingResponse,
} from "@tearleads/validators/response";

export const FREE_TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
export const LAPSED_BILLING_PURGE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface OrganizationBilling {
  readonly organizationId: string;
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: Date | null;
  readonly provider: OrganizationBillingProvider | null;
  readonly currentPeriodStartsAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
  readonly seatCount: number;
  readonly disabledAt: Date | null;
  readonly purgeAfter: Date | null;
}

/**
 * Billing fields for an organization that should remain local-only: free,
 * on-device only, no server sync, and no trial consumed.
 */
export function createLocalBillingFields(): {
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: null;
} {
  return { status: "local", trialEndsAt: null };
}

/**
 * Billing fields for an organization that has just started its free sync trial.
 */
export function createTrialBillingFields(now: Date = new Date()): {
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: Date;
} {
  return {
    status: "trialing",
    trialEndsAt: new Date(now.getTime() + FREE_TRIAL_MS),
  };
}

/**
 * Whether an organization may sync to the server. Sync is the paid feature:
 * only non-expired active and trialing organizations sync; `local` (free),
 * `past_due`, `disabled`, `deleting`, and `purged` stay on-device.
 *
 * Expiry is evaluated in-memory against `now` rather than trusting the
 * persisted status. A row whose billing period has passed but which has not yet
 * been flipped to `disabled` must NOT be treated as syncable — otherwise write
 * paths that read the billing row directly would keep accepting expired billing
 * indefinitely.
 */
export function organizationCanSync(
  billing: {
    readonly currentPeriodEndsAt: Date | null;
    readonly status: OrganizationBillingStatus;
    readonly trialEndsAt: Date | null;
  },
  now: Date = new Date(),
): boolean {
  if (billing.status === "active") {
    return (
      billing.currentPeriodEndsAt === null || billing.currentPeriodEndsAt > now
    );
  }
  if (billing.status === "trialing") {
    return billing.trialEndsAt !== null && billing.trialEndsAt > now;
  }
  return false;
}

export function serializeOrganizationBilling(
  billing: OrganizationBilling,
): OrganizationBillingResponse {
  return {
    organizationId: billing.organizationId,
    status: billing.status,
    trialEndsAt: billing.trialEndsAt?.toISOString() ?? null,
    provider: billing.provider,
    currentPeriodStartsAt: billing.currentPeriodStartsAt?.toISOString() ?? null,
    currentPeriodEndsAt: billing.currentPeriodEndsAt?.toISOString() ?? null,
    seatCount: billing.seatCount,
    disabledAt: billing.disabledAt?.toISOString() ?? null,
    purgeAfter: billing.purgeAfter?.toISOString() ?? null,
  };
}

/**
 * One `revenuecat_webhook_events` audit row projected for the history read:
 * what happened (`eventType`), whether it changed billing (`outcome`), and
 * when the provider says it happened (`eventTimestamp`).
 */
export interface OrganizationBillingHistoryEvent {
  readonly eventType: string;
  readonly outcome: string;
  readonly eventTimestamp: Date;
  readonly productId: string | null;
  readonly transactionId: string | null;
}

export function serializeOrganizationBillingHistory(
  organizationId: string,
  events: readonly OrganizationBillingHistoryEvent[],
): OrganizationBillingHistoryResponse {
  return {
    organizationId,
    entries: events.map((event) => ({
      eventType: event.eventType,
      // The webhook only ever records `applied`/`ignored`; anything else in the
      // audit column is surfaced as `ignored` rather than failing the read.
      outcome: event.outcome === "applied" ? "applied" : "ignored",
      occurredAt: event.eventTimestamp.toISOString(),
      productId: event.productId,
      transactionId: event.transactionId,
    })),
  };
}
