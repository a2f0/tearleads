import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingProvider,
  type OrganizationBillingStatus,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { getSyncBillingTierForSeatCount } from "@tearleads/validators/billing";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq, inArray, or } from "drizzle-orm";
import {
  resolveOrganizationIdFromTransactionMetadata,
  resolveStripeStoreOrganizationId,
} from "../../billing/revenuecatWebhook";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { getSyncBillingTierForStripePrice } from "../../billing/stripeHttp";
import { startsLaterBillingPeriod } from "./stripePeriodMatch";

type StripeResolutionSource = "durable" | "provider";

export type ImmutableStripeStoreOrgResolution =
  | {
      kind: "resolved";
      identifiers: readonly string[];
      organizationId: string;
      priceId: string | null;
      /** Capacity of the bound Price alone. */
      priceSeatCount: number | null;
      seatCount: number | null;
      source: StripeResolutionSource;
    }
  | { kind: "none" }
  | { kind: "error" };

export interface LockedBillingIdentity {
  readonly checkoutAttemptExpiresAt: Date | null;
  readonly checkoutAttemptId: string | null;
  readonly provider: OrganizationBillingProvider | null;
  readonly providerCustomerId: string | null;
  readonly providerProductId: string | null;
  readonly providerSubscriptionId: string | null;
  readonly providerTransactionId: string | null;
  readonly seatCount: number;
  readonly status: OrganizationBillingStatus;
}

interface StripeSeatBindingIdentity {
  readonly subscriptionId: string | null;
  readonly subscriptionItemId: string | null;
}

function stripeEventIdentifiers(event: RevenueCatWebhookEvent): string[] {
  return [event.original_transaction_id, event.transaction_id].filter(
    (value): value is string => typeof value === "string",
  );
}

function bindingMatchesIdentifiers(
  binding: StripeSeatBindingIdentity,
  identifiers: readonly string[],
): boolean {
  const subscriptionIds = identifiers.filter((value) =>
    value.startsWith("sub_"),
  );
  const itemIds = identifiers.filter((value) => value.startsWith("si_"));
  const hasExactMatch =
    subscriptionIds.includes(binding.subscriptionId ?? "") ||
    itemIds.includes(binding.subscriptionItemId ?? "");
  return (
    hasExactMatch &&
    subscriptionIds.every((value) => value === binding.subscriptionId) &&
    itemIds.every((value) => value === binding.subscriptionItemId)
  );
}

async function resolveDurableStripeStoreOrganizationId(
  db: ApiDatabase,
  event: RevenueCatWebhookEvent,
  deps: StripeApiDeps,
): Promise<ImmutableStripeStoreOrgResolution> {
  if (event.store?.toUpperCase() !== "STRIPE") {
    return { kind: "none" };
  }
  const identifiers = [...new Set(stripeEventIdentifiers(event))];
  if (identifiers.length === 0) {
    return { kind: "error" };
  }
  const rows = await db
    .select({
      appliedPaidCapacity: organizationBillingStripeSeats.appliedPaidCapacity,
      billingPeriodEndsAt: organizationBillingStripeSeats.billingPeriodEndsAt,
      billingPeriodStartsAt:
        organizationBillingStripeSeats.billingPeriodStartsAt,
      organizationId: organizationBillingStripeSeats.organizationId,
      priceId: organizationBillingStripeSeats.priceId,
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(
      or(
        inArray(organizationBillingStripeSeats.subscriptionId, identifiers),
        inArray(organizationBillingStripeSeats.subscriptionItemId, identifiers),
      ),
    )
    .limit(2);
  const binding = rows[0];
  if (rows.length === 0) {
    return { kind: "none" };
  }
  if (
    rows.length !== 1 ||
    !binding ||
    !bindingMatchesIdentifiers(binding, identifiers)
  ) {
    return { kind: "error" };
  }
  const priceSeatCount =
    getSyncBillingTierForStripePrice(binding.priceId, deps)?.seatLimit ?? null;
  return {
    identifiers,
    kind: "resolved",
    organizationId: binding.organizationId,
    priceId: binding.priceId,
    priceSeatCount,
    seatCount: durableSeatCount(event, binding, priceSeatCount),
    source: "durable",
  };
}

/**
 * The capacity a grant for the bound subscription licenses. The bound Price
 * is what the subscription renews at, which a scheduled smaller plan lowers
 * before renewal (workflows/billing/stripePlanChange.ts). Only an event that
 * starts a later period than the one bound (a renewal) grants that Price's
 * capacity alone; any event within the paid period, including an extension
 * that moves its end, keeps the capacity paid for it, so seats are never
 * taken away before the renewal.
 */
function durableSeatCount(
  event: RevenueCatWebhookEvent,
  binding: {
    readonly appliedPaidCapacity: number;
    readonly billingPeriodEndsAt: Date | null;
    readonly billingPeriodStartsAt: Date | null;
  },
  priceSeatCount: number | null,
): number | null {
  if (priceSeatCount === null) {
    return null;
  }
  const paid = getSyncBillingTierForSeatCount(binding.appliedPaidCapacity);
  return paid && eventInPaidPeriod(event, binding)
    ? Math.max(priceSeatCount, paid.seatLimit)
    : priceSeatCount;
}

/**
 * Recomputes a durable resolution's capacity from the seat row as it is now,
 * under the billing lock its writers take: a plan change that landed after
 * the event was resolved (an upgrade's paid capacity) must not be overwritten
 * by the earlier read. Null when the bound Price changed since, which the
 * caller retries.
 */
export async function lockedDurableStripeSeatCount(input: {
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly resolution: Extract<
    ImmutableStripeStoreOrgResolution,
    { kind: "resolved" }
  >;
}): Promise<number | null> {
  const [binding] = await input.executor
    .select({
      appliedPaidCapacity: organizationBillingStripeSeats.appliedPaidCapacity,
      billingPeriodEndsAt: organizationBillingStripeSeats.billingPeriodEndsAt,
      billingPeriodStartsAt:
        organizationBillingStripeSeats.billingPeriodStartsAt,
      priceId: organizationBillingStripeSeats.priceId,
    })
    .from(organizationBillingStripeSeats)
    .where(
      eq(
        organizationBillingStripeSeats.organizationId,
        input.resolution.organizationId,
      ),
    )
    .limit(1);
  if (!binding || binding.priceId !== input.resolution.priceId) {
    return null;
  }
  return durableSeatCount(
    input.event,
    binding,
    input.resolution.priceSeatCount,
  );
}

/**
 * Whether the event belongs to the bound paid period (or an earlier one).
 * Only an event that starts a later period, its purchase half a period or
 * more after the bound start, is a renewal; RevenueCat's timestamps for one
 * period trail Stripe's by far less. An event that shows no start cannot be
 * told from an extension, which reports only a later end, so it keeps the
 * paid period.
 */
function eventInPaidPeriod(
  event: RevenueCatWebhookEvent,
  binding: {
    readonly billingPeriodEndsAt: Date | null;
    readonly billingPeriodStartsAt: Date | null;
  },
): boolean {
  const startsAt = binding.billingPeriodStartsAt;
  return (
    event.purchased_at_ms == null ||
    startsAt === null ||
    !startsLaterBillingPeriod(event.purchased_at_ms, {
      endsAt: binding.billingPeriodEndsAt,
      startsAt,
    })
  );
}

/** Resolves an immutable candidate; locked database validation happens later. */
export async function resolveImmutableStripeStoreOrganizationId(
  db: ApiDatabase,
  event: RevenueCatWebhookEvent,
  deps: StripeApiDeps,
): Promise<ImmutableStripeStoreOrgResolution> {
  const durableResolution = await resolveDurableStripeStoreOrganizationId(
    db,
    event,
    deps,
  );
  if (durableResolution.kind !== "none") {
    return durableResolution;
  }
  if (event.store?.toUpperCase() !== "STRIPE") {
    return { kind: "none" };
  }

  const identifiers = [...new Set(stripeEventIdentifiers(event))];
  const metadataOrganizationId =
    resolveOrganizationIdFromTransactionMetadata(event);

  const providerResolution = await resolveStripeStoreOrganizationId(
    event,
    deps,
  );
  if (providerResolution.kind !== "resolved") {
    return providerResolution;
  }
  if (
    metadataOrganizationId &&
    metadataOrganizationId !== providerResolution.organizationId
  ) {
    return { kind: "error" };
  }
  return {
    identifiers,
    kind: "resolved",
    organizationId: providerResolution.organizationId,
    priceId: providerResolution.priceId,
    priceSeatCount: providerResolution.seatCount,
    seatCount: providerResolution.seatCount,
    source: "provider",
  };
}

async function readCurrentStripeBinding(
  executor: DatabaseSession,
  organizationId: string,
): Promise<StripeSeatBindingIdentity | undefined> {
  const [binding] = await executor
    .select({
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId))
    .limit(1);
  return binding;
}

/**
 * Revalidates a pre-transaction candidate after the billing row is locked.
 * Stripe binding writers take the same billing lock before changing the outbox,
 * so this read cannot race a subscription replacement.
 */
export async function validateLockedStripeStoreOrganizationId(input: {
  readonly billing: LockedBillingIdentity;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly resolution: Extract<
    ImmutableStripeStoreOrgResolution,
    { kind: "resolved" }
  >;
}): Promise<boolean> {
  const currentBinding = await readCurrentStripeBinding(
    input.executor,
    input.resolution.organizationId,
  );
  if (
    currentBinding &&
    bindingMatchesIdentifiers(currentBinding, input.resolution.identifiers)
  ) {
    return true;
  }
  if (
    input.resolution.source === "durable" ||
    currentBinding?.subscriptionId ||
    currentBinding?.subscriptionItemId
  ) {
    return false;
  }

  const [identifier] = input.resolution.identifiers;
  if (!identifier) {
    return false;
  }
  return (
    (input.billing.providerSubscriptionId === null ||
      input.billing.providerSubscriptionId === identifier) &&
    (input.billing.providerCustomerId === null ||
      input.billing.providerCustomerId === input.event.app_user_id)
  );
}
