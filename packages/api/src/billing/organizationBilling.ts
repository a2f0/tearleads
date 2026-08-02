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

/** Stable identity for the trial/paid interval represented by seat capacity. */
export function organizationSeatPeriodKey(input: {
  readonly currentPeriodEndsAt: Date | null;
  readonly currentPeriodStartsAt: Date | null;
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: Date | null;
}): string {
  if (input.status === "trialing") {
    return `trial:${input.trialEndsAt?.toISOString() ?? "open"}`;
  }
  return (
    `paid:${input.currentPeriodStartsAt?.toISOString() ?? "open"}:` +
    (input.currentPeriodEndsAt?.toISOString() ?? "open")
  );
}

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
  activeMemberCount: number,
  pendingSeatCount: number | null = null,
): OrganizationBillingResponse {
  return {
    organizationId: billing.organizationId,
    activeMemberCount,
    status: billing.status,
    trialEndsAt: billing.trialEndsAt?.toISOString() ?? null,
    provider: billing.provider,
    currentPeriodStartsAt: billing.currentPeriodStartsAt?.toISOString() ?? null,
    currentPeriodEndsAt: billing.currentPeriodEndsAt?.toISOString() ?? null,
    seatCount: billing.seatCount,
    pendingSeatCount,
    disabledAt: billing.disabledAt?.toISOString() ?? null,
    purgeAfter: billing.purgeAfter?.toISOString() ?? null,
  };
}

/** One normalized billing audit row before dates are serialized for the wire. */
export interface OrganizationBillingHistoryEvent {
  readonly id: string;
  readonly category: "lifecycle" | "seat" | "invoice";
  readonly provider: "revenuecat" | "stripe" | "internal";
  readonly eventType: string;
  readonly outcome: string;
  readonly eventTimestamp: Date;
  readonly productId: string | null;
  readonly transactionId: string | null;
  readonly invoiceId: string | null;
  readonly subscriptionId: string | null;
  readonly billingReason: string | null;
  readonly seatCount: number | null;
  readonly seatDelta: number | null;
  readonly activeSeatCount: number | null;
  readonly priceId: string | null;
  readonly unitAmount: number | null;
  readonly currency: string | null;
  readonly interval: string | null;
  readonly intervalCount: number | null;
  readonly totalAmount: number | null;
  readonly periodStartsAt: Date | null;
  readonly periodEndsAt: Date | null;
}

export function serializeOrganizationBillingHistory(
  organizationId: string,
  events: readonly OrganizationBillingHistoryEvent[],
): OrganizationBillingHistoryResponse {
  return {
    organizationId,
    entries: events.map((event) => ({
      id: event.id,
      category: event.category,
      provider: event.provider,
      eventType: event.eventType,
      // Audit writers only record `applied`/`ignored`; anything else is
      // surfaced as `ignored` rather than making the history unreadable.
      outcome: event.outcome === "applied" ? "applied" : "ignored",
      occurredAt: event.eventTimestamp.toISOString(),
      productId: event.productId,
      transactionId: event.transactionId,
      invoiceId: event.invoiceId,
      subscriptionId: event.subscriptionId,
      billingReason: event.billingReason,
      seatCount: event.seatCount,
      seatDelta: event.seatDelta,
      activeSeatCount: event.activeSeatCount,
      priceId: event.priceId,
      unitAmount: event.unitAmount,
      currency: event.currency,
      interval: event.interval,
      intervalCount: event.intervalCount,
      totalAmount: event.totalAmount,
      periodStartsAt: event.periodStartsAt?.toISOString() ?? null,
      periodEndsAt: event.periodEndsAt?.toISOString() ?? null,
    })),
  };
}
