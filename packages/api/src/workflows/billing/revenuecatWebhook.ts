import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingStatus,
  organizationBilling,
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { and, eq, gt } from "drizzle-orm";
import { allowsRevenueCatSandboxEvents } from "../../billing/revenueCatConfig";
import {
  classifyRevenueCatEvent,
  type RevenueCatBillingTransition,
  resolveOrganizationIdFromEvent,
  SANDBOX_IGNORED_REASON,
  UNCONFIGURED_SYNC_BILLING_TIER_REASON,
} from "../../billing/revenuecatWebhook";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";
import {
  isNativeRevenueCatStore,
  resolveRevenueCatBuyerIgnoredReason,
} from "./revenuecatBuyerPolicy";
import {
  resolveRevenueCatGrantCapacity,
  STRIPE_GRANT_EXCEEDS_CAPACITY_REASON,
} from "./revenuecatGrantCapacity";
import {
  type ImmutableStripeStoreOrgResolution,
  type LockedBillingIdentity,
  resolveImmutableStripeStoreOrganizationId,
  validateLockedStripeStoreOrganizationId,
} from "./revenuecatStripeResolution";

/**
 * Disposition of a processed RevenueCat webhook event:
 * - `applied`: the org's billing row was updated to `billingStatus`.
 * - `ignored`: the event was recorded but changed nothing (unhandled type,
 *   no/unknown org, or a non-admin buyer).
 * - `duplicate`: the event id was already processed; nothing was re-applied.
 */
export type RevenueCatWebhookOutcome =
  | {
      status: "applied";
      organizationId: string;
      billingStatus: OrganizationBillingStatus;
    }
  | { status: "ignored"; reason: string }
  | { status: "duplicate" }
  /**
   * The event could not be safely attributed right now (e.g. a Stripe-store
   * event whose immutable subscription lookup failed). Nothing was recorded
   * or claimed; the route answers non-2xx so RevenueCat redelivers.
   */
  | { status: "retry"; reason: string };

/**
 * Loads the org's billing row and, on Postgres, takes a `FOR UPDATE` row lock on
 * it. The lock serializes concurrent webhook transactions for the SAME org:
 * without it, two events racing could both pass {@link hasNewerAppliedEvent} and
 * commit out of order (last write wins regardless of event time). SQLite writes
 * are already serialized, so the lock is Postgres-only.
 */
async function lockBillingIdentity(
  executor: DatabaseSession,
  organizationId: string,
): Promise<LockedBillingIdentity | undefined> {
  const lockQuery = executor
    .select({
      providerCustomerId: organizationBilling.providerCustomerId,
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId))
    .limit(1);
  const [row] = isSqliteApiDatabase()
    ? await lockQuery
    : await lockQuery.for("update");
  return row;
}

async function hasNewerAppliedEvent(
  executor: DatabaseSession,
  organizationId: string,
  event: RevenueCatWebhookEvent,
): Promise<boolean> {
  const [newer] = await executor
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.organizationId, organizationId),
        eq(revenuecatWebhookEvents.outcome, "applied"),
        gt(
          revenuecatWebhookEvents.eventTimestamp,
          new Date(event.event_timestamp_ms),
        ),
      ),
    )
    .limit(1);
  return newer !== undefined;
}

/**
 * Read-only reason the event should NOT be applied, or null when it should.
 * Runs before the idempotency claim so the recorded outcome is accurate and no
 * write happens for events we ultimately ignore.
 */
async function resolveIgnoredReason(
  executor: DatabaseSession,
  transition: RevenueCatBillingTransition,
  organizationId: string | null,
  event: RevenueCatWebhookEvent,
  billing: LockedBillingIdentity | undefined,
): Promise<string | null> {
  if (transition.kind === "ignore") {
    return transition.reason;
  }
  if (organizationId === null) {
    return "Event carried no organization id";
  }

  if (!billing) {
    return "Unknown organization";
  }

  if (transition.kind === "grant") {
    const buyerIgnoredReason = await resolveRevenueCatBuyerIgnoredReason({
      currentProviderCustomerId: billing.providerCustomerId,
      event,
      executor,
      organizationId,
    });
    if (buyerIgnoredReason) {
      return buyerIgnoredReason;
    }
  }

  // Reject stale, out-of-order deliveries: if a newer event has already been
  // *applied* to this org, do not let this older event overwrite it (e.g. a
  // retried EXPIRATION arriving after the RENEWAL that superseded it). Only
  // applied events count, so an ignored/test event can never block a real one.
  if (await hasNewerAppliedEvent(executor, organizationId, event)) {
    return "A newer billing event has already been applied";
  }

  return null;
}

type AppliedRevenueCatTransition = Exclude<
  RevenueCatBillingTransition,
  { kind: "ignore" }
>;

type PreclaimDisposition =
  | {
      kind: "continue";
      ignoredReason: string | null;
      skipSeatReconciliation: boolean;
      warning: string | null;
    }
  | { kind: "retry"; reason: string };

async function resolvePreclaimDisposition(input: {
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string | null;
  readonly stripeResolution: ImmutableStripeStoreOrgResolution;
  readonly transition: RevenueCatBillingTransition;
}): Promise<PreclaimDisposition> {
  // Binding writers take this same lock before updating the outbox. Validate
  // the pre-transaction candidate only after it is held.
  const billing =
    input.transition.kind !== "ignore" && input.organizationId !== null
      ? await lockBillingIdentity(input.executor, input.organizationId)
      : undefined;
  if (
    input.stripeResolution.kind === "resolved" &&
    billing &&
    !(await validateLockedStripeStoreOrganizationId({
      billing,
      event: input.event,
      executor: input.executor,
      resolution: input.stripeResolution,
    }))
  ) {
    return {
      kind: "retry",
      reason: "Stripe binding changed before RevenueCat event application",
    };
  }
  const capacity = input.organizationId
    ? await resolveRevenueCatGrantCapacity({
        event: input.event,
        executor: input.executor,
        organizationId: input.organizationId,
        transition: input.transition,
      })
    : { kind: "within_capacity" as const };
  const ignoredReason =
    capacity.kind === "ignore"
      ? capacity.reason
      : await resolveIgnoredReason(
          input.executor,
          input.transition,
          input.organizationId,
          input.event,
          billing,
        );
  return {
    ignoredReason,
    kind: "continue",
    skipSeatReconciliation: capacity.kind === "apply_without_reconciliation",
    warning:
      capacity.kind === "apply_without_reconciliation" ? capacity.reason : null,
  };
}

async function claimRevenueCatEvent(input: {
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly ignoredReason: string | null;
  readonly organizationId: string | null;
}): Promise<boolean> {
  const [claimed] = await input.executor
    .insert(revenuecatWebhookEvents)
    .values({
      eventId: input.event.id,
      eventType: input.event.type,
      appUserId: input.event.app_user_id,
      productId: input.event.product_id ?? null,
      transactionId: input.event.transaction_id ?? null,
      originalTransactionId: input.event.original_transaction_id ?? null,
      organizationId: input.organizationId,
      outcome: input.ignoredReason ? "ignored" : "applied",
      eventTimestamp: new Date(input.event.event_timestamp_ms),
      purchasedAt:
        input.event.purchased_at_ms != null
          ? new Date(input.event.purchased_at_ms)
          : null,
      expirationAt:
        input.event.expiration_at_ms != null
          ? new Date(input.event.expiration_at_ms)
          : null,
    })
    .onConflictDoNothing({ target: revenuecatWebhookEvents.eventId })
    .returning({ id: revenuecatWebhookEvents.id });
  return claimed !== undefined;
}

async function applyRevenueCatTransition(input: {
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string;
  readonly reconcileSeats: boolean;
  readonly transition: AppliedRevenueCatTransition;
}): Promise<RevenueCatWebhookOutcome> {
  await input.executor
    .update(organizationBilling)
    .set({ ...input.transition.fields, updatedAt: input.now })
    .where(eq(organizationBilling.organizationId, input.organizationId));
  if (
    input.transition.kind === "grant" &&
    isNativeRevenueCatStore(input.event.store)
  ) {
    // A device-store grant supersedes any cancelled Stripe binding.
    // Removing the outbox row prevents the seat worker from retrying that old
    // subscription while the native RevenueCat entitlement is active. Promo
    // grants intentionally retain a live Stripe binding and its seat worker.
    await input.executor
      .delete(organizationBillingStripeSeats)
      .where(
        eq(organizationBillingStripeSeats.organizationId, input.organizationId),
      );
  }
  if (input.transition.kind === "grant" && input.reconcileSeats) {
    await reconcileOrganizationBillingSeats({
      executor: input.executor,
      now: input.now,
      organizationId: input.organizationId,
      source: {
        sourceId: input.event.id,
        sourceType: "provider_event",
      },
    });
  }
  return {
    status: "applied",
    organizationId: input.organizationId,
    billingStatus: input.transition.fields.status,
  };
}

async function runRevenueCatWebhookTransaction(input: {
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string | null;
  readonly stripeResolution: ImmutableStripeStoreOrgResolution;
  readonly transition: RevenueCatBillingTransition;
}): Promise<RevenueCatWebhookOutcome> {
  const disposition = await resolvePreclaimDisposition(input);
  if (disposition.kind === "retry") {
    return { status: "retry", reason: disposition.reason };
  }
  const claimed = await claimRevenueCatEvent({
    event: input.event,
    executor: input.executor,
    ignoredReason: disposition.ignoredReason,
    organizationId: input.organizationId,
  });
  if (!claimed) {
    return { status: "duplicate" };
  }
  if (disposition.ignoredReason) {
    return { status: "ignored", reason: disposition.ignoredReason };
  }
  if (input.transition.kind === "ignore" || input.organizationId === null) {
    return { status: "ignored", reason: "Event carried no organization id" };
  }
  const outcome = await applyRevenueCatTransition({
    event: input.event,
    executor: input.executor,
    now: input.now,
    organizationId: input.organizationId,
    reconcileSeats: !disposition.skipSeatReconciliation,
    transition: input.transition,
  });
  if (disposition.warning) {
    console.error(
      `RevenueCat paid grant ${input.event.id} requires attention: ${disposition.warning}`,
    );
  }
  return outcome;
}

/**
 * Applies a RevenueCat webhook event to organization sync billing.
 *
 * Idempotent on the provider event id: the event is claimed by inserting its id
 * (a duplicate delivery inserts nothing and re-applies nothing). The billing
 * effect is computed purely by {@link classifyRevenueCatEvent}, which ignores
 * store-sandbox events unless the tier sets
 * `REVENUECAT_ALLOW_SANDBOX_EVENTS=true`. Stripe-store
 * transitions use the durable subscription binding or an exact Stripe
 * subscription lookup; transaction metadata is only a consistency check.
 * Other stores use transaction metadata or the `orgId` subscriber attribute.
 * Binding a new RevenueCat customer to an org additionally requires
 * the buyer (App User ID) to be an org admin — a non-admin buyer is recorded and
 * ignored rather than granted. All writes happen in one transaction so the
 * idempotency claim gates the billing write.
 */
export async function runRevenueCatWebhookWorkflow(
  db: ApiDatabase,
  event: RevenueCatWebhookEvent,
  now: Date = new Date(),
  deps: { stripe?: StripeApiDeps; env?: NodeJS.ProcessEnv } = {},
): Promise<RevenueCatWebhookOutcome> {
  const isStripeStore = event.store?.toUpperCase() === "STRIPE";
  const classificationOptions = {
    // A store-sandbox purchase (StoreKit sandbox, TestFlight, Play internal
    // testing) is free to the tester but emits an event otherwise identical to
    // a paid one, so only a tier that opts in applies it.
    allowSandboxEvents: allowsRevenueCatSandboxEvents(deps.env ?? process.env),
    // A Stripe grant's actual capacity comes from the immutable subscription
    // binding below. This placeholder lets classification determine whether
    // the event type needs that lookup without trusting RevenueCat's product id.
    ...(isStripeStore ? { stripeSeatCount: 1 } : {}),
  };
  const initialTransition = classifyRevenueCatEvent(
    event,
    now,
    classificationOptions,
  );
  if (
    initialTransition.kind === "ignore" &&
    initialTransition.reason === SANDBOX_IGNORED_REASON
  ) {
    // Otherwise the only trace of a dropped sandbox event is a database row,
    // which reads exactly like the "webhook that silently does nothing" a
    // tester hits when the tier has not opted in. Gated on the sandbox reason
    // specifically, not on "ignored while carrying an environment": routine
    // production ignores (an unhandled type, a cancellation without lapse)
    // are ordinary traffic and must not warn.
    console.warn(
      `RevenueCat event ${event.id} (${event.type}, store=${event.store ?? "unknown"}, environment=${event.environment}) ignored: ${initialTransition.reason}`,
    );
  }
  // Stripe-store events use the immutable per-subscription org binding — the
  // customer-level attribute could have been rebound by a later purchase for
  // another org. A FAILED lookup on an event that would change billing must
  // defer (never fall back to the attribute, never claim the event id) so a
  // redelivery can attribute it correctly.
  // Ignorable events never consult Stripe. They cannot change billing, and a
  // Stripe-store audit row is recorded without attributing the mutable orgId.
  const stripeResolution =
    initialTransition.kind === "ignore"
      ? ({ kind: "none" } satisfies ImmutableStripeStoreOrgResolution)
      : await resolveImmutableStripeStoreOrganizationId(
          db,
          event,
          deps.stripe ?? {},
        );
  if (stripeResolution.kind === "error") {
    return {
      status: "retry",
      reason: "Stripe subscription lookup failed for a Stripe-store event",
    };
  }
  if (
    initialTransition.kind === "grant" &&
    stripeResolution.kind === "resolved" &&
    (stripeResolution.priceId === null || stripeResolution.seatCount === null)
  ) {
    console.error(
      `RevenueCat paid grant ${event.id} was not applied: Stripe subscription tier could not be resolved`,
    );
    return {
      status: "retry",
      reason: "Stripe subscription tier could not be resolved",
    };
  }
  const transition =
    stripeResolution.kind === "resolved"
      ? classifyRevenueCatEvent(event, now, {
          ...classificationOptions,
          ...(stripeResolution.priceId
            ? { stripePriceId: stripeResolution.priceId }
            : {}),
          stripeSeatCount: stripeResolution.seatCount ?? 1,
        })
      : initialTransition;
  const organizationId =
    stripeResolution.kind === "resolved"
      ? stripeResolution.organizationId
      : event.store?.toUpperCase() === "STRIPE"
        ? null
        : resolveOrganizationIdFromEvent(event);

  const outcome = await db.transaction((tx) =>
    runRevenueCatWebhookTransaction({
      event,
      executor: tx,
      now,
      organizationId,
      stripeResolution,
      transition,
    }),
  );
  logUnappliedPaidGrant(event.id, outcome);
  return outcome;
}

function logUnappliedPaidGrant(
  eventId: string,
  outcome: RevenueCatWebhookOutcome,
): void {
  if (outcome.status !== "ignored") {
    return;
  }
  if (
    outcome.reason !== UNCONFIGURED_SYNC_BILLING_TIER_REASON &&
    outcome.reason !== STRIPE_GRANT_EXCEEDS_CAPACITY_REASON
  ) {
    return;
  }
  console.error(
    `RevenueCat paid grant ${eventId} was not applied: ${outcome.reason}`,
  );
}
