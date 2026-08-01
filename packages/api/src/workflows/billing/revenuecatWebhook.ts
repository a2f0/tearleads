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
import { eq } from "drizzle-orm";
import { allowsRevenueCatSandboxEvents } from "../../billing/revenueCatConfig";
import {
  BOUND_REVENUECAT_TIER_REQUIRED_REASON,
  classifyRevenueCatEvent,
  type RevenueCatBillingTransition,
  resolveOrganizationIdFromEvent,
  SANDBOX_IGNORED_REASON,
} from "../../billing/revenuecatWebhook";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";
import { isNativeRevenueCatStore } from "./revenuecatBuyerPolicy";
import {
  resolveBoundRevenueCatGrantTransition,
  resolveRevenueCatGrantCapacity,
} from "./revenuecatGrantCapacity";
import { resolveNativeStripeConflictReason } from "./revenuecatProviderConflict";
import {
  type ImmutableStripeStoreOrgResolution,
  type LockedBillingIdentity,
  resolveImmutableStripeStoreOrganizationId,
  validateLockedStripeStoreOrganizationId,
} from "./revenuecatStripeResolution";
import { logUnappliedRevenueCatGrant } from "./revenuecatWebhookLogging";
import {
  isStripeEventSupersededByNative,
  lockRevenueCatBillingIdentity,
  resolveLockedStripeTierFallback,
  resolveRevenueCatIgnoredReason,
  SUPERSEDED_STRIPE_EVENT_REASON,
  UNRESOLVED_STRIPE_TIER_REASON,
} from "./revenuecatWebhookPolicy";

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

type AppliedRevenueCatTransition = Exclude<
  RevenueCatBillingTransition,
  { kind: "ignore" }
>;

type PreclaimDisposition =
  | {
      kind: "continue";
      deleteStripeBinding: boolean;
      ignoredReason: string | null;
      preserveStripeBinding: boolean;
      skipSeatReconciliation: boolean;
      transition: RevenueCatBillingTransition;
      warning: string | null;
    }
  | { kind: "retry"; reason: string };

interface RevenueCatPreclaimInput {
  readonly allowSandboxEvents: boolean;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string | null;
  readonly stripeResolution: ImmutableStripeStoreOrgResolution;
  readonly stripeTierUnresolved: boolean;
  readonly transition: RevenueCatBillingTransition;
}

async function resolveGrantApplicationDisposition(input: {
  readonly billing: LockedBillingIdentity | undefined;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string | null;
  readonly skipSeatReconciliation: boolean;
  readonly transition: RevenueCatBillingTransition;
  readonly warning: string | null;
}): Promise<PreclaimDisposition> {
  const nativeStripeConflict =
    input.transition.kind === "grant" && input.organizationId && input.billing
      ? await resolveNativeStripeConflictReason({
          executor: input.executor,
          organizationId: input.organizationId,
          status: input.billing.status,
          store: input.event.store,
        })
      : null;
  const capacity =
    input.organizationId && nativeStripeConflict === null
      ? await resolveRevenueCatGrantCapacity({
          event: input.event,
          executor: input.executor,
          organizationId: input.organizationId,
          transition: input.transition,
        })
      : { kind: "within_capacity" as const };
  const capacityWarning =
    capacity.kind === "apply_without_reconciliation" ? capacity.reason : null;
  return {
    deleteStripeBinding: false,
    ignoredReason: null,
    kind: "continue",
    preserveStripeBinding: nativeStripeConflict !== null,
    skipSeatReconciliation:
      input.skipSeatReconciliation ||
      nativeStripeConflict !== null ||
      capacity.kind === "apply_without_reconciliation",
    transition: input.transition,
    warning:
      [input.warning, nativeStripeConflict, capacityWarning]
        .filter((reason): reason is string => reason !== null)
        .join("; ") || null,
  };
}

function unresolvedStripeTierRetry(
  event: RevenueCatWebhookEvent,
): PreclaimDisposition {
  console.error(
    `RevenueCat paid grant ${event.id} was not applied: ${UNRESOLVED_STRIPE_TIER_REASON}`,
  );
  return { kind: "retry", reason: UNRESOLVED_STRIPE_TIER_REASON };
}

async function resolvePreclaimDisposition(
  input: RevenueCatPreclaimInput,
): Promise<PreclaimDisposition> {
  const billing =
    (input.transition.kind !== "ignore" ||
      input.transition.reason === BOUND_REVENUECAT_TIER_REQUIRED_REASON) &&
    input.organizationId !== null
      ? await lockRevenueCatBillingIdentity(
          input.executor,
          input.organizationId,
        )
      : undefined;
  let transition = resolveBoundRevenueCatGrantTransition({
    allowSandboxEvents: input.allowSandboxEvents,
    billing,
    event: input.event,
    now: input.now,
    transition: input.transition,
  });
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
  if (isStripeEventSupersededByNative(billing, input.stripeResolution)) {
    return {
      deleteStripeBinding: transition.kind === "revoke",
      ignoredReason: SUPERSEDED_STRIPE_EVENT_REASON,
      kind: "continue",
      preserveStripeBinding: false,
      skipSeatReconciliation: true,
      transition,
      warning: null,
    };
  }
  let warning: string | null = null;
  if (
    input.stripeTierUnresolved &&
    input.stripeResolution.kind === "resolved"
  ) {
    const fallback = resolveLockedStripeTierFallback({
      allowSandboxEvents: input.allowSandboxEvents,
      billing,
      event: input.event,
      now: input.now,
      resolution: input.stripeResolution,
    });
    if (!fallback || fallback.kind !== "grant") {
      return unresolvedStripeTierRetry(input.event);
    }
    transition = fallback;
    warning = `${UNRESOLVED_STRIPE_TIER_REASON}; preserving the locked billing tier`;
  }
  const ignoredReason = await resolveRevenueCatIgnoredReason({
    billing,
    event: input.event,
    executor: input.executor,
    organizationId: input.organizationId,
    transition,
  });
  if (ignoredReason) {
    return {
      deleteStripeBinding: false,
      ignoredReason,
      kind: "continue",
      preserveStripeBinding: false,
      skipSeatReconciliation: true,
      transition,
      warning: null,
    };
  }
  return resolveGrantApplicationDisposition({
    billing,
    event: input.event,
    executor: input.executor,
    organizationId: input.organizationId,
    skipSeatReconciliation: warning !== null,
    transition,
    warning,
  });
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
  readonly preserveStripeBinding: boolean;
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
    if (input.preserveStripeBinding) {
      // Keep identity for final-event attribution. A null Price quarantines
      // seat sync and management; the native product controls both instead.
      await input.executor
        .update(organizationBillingStripeSeats)
        .set({
          inFlightOperationId: null,
          inFlightTargetCapacity: null,
          leaseExpiresAt: null,
          leaseId: null,
          nextAttemptAt: null,
          priceId: null,
          updatedAt: input.now,
        })
        .where(
          eq(
            organizationBillingStripeSeats.organizationId,
            input.organizationId,
          ),
        );
    } else {
      await input.executor
        .delete(organizationBillingStripeSeats)
        .where(
          eq(
            organizationBillingStripeSeats.organizationId,
            input.organizationId,
          ),
        );
    }
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
  readonly allowSandboxEvents: boolean;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string | null;
  readonly stripeResolution: ImmutableStripeStoreOrgResolution;
  readonly stripeTierUnresolved: boolean;
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
  if (disposition.deleteStripeBinding && input.organizationId !== null) {
    await input.executor
      .delete(organizationBillingStripeSeats)
      .where(
        eq(organizationBillingStripeSeats.organizationId, input.organizationId),
      );
  }
  if (disposition.ignoredReason) {
    return { status: "ignored", reason: disposition.ignoredReason };
  }
  if (
    disposition.transition.kind === "ignore" ||
    input.organizationId === null
  ) {
    return { status: "ignored", reason: "Event carried no organization id" };
  }
  const outcome = await applyRevenueCatTransition({
    event: input.event,
    executor: input.executor,
    now: input.now,
    organizationId: input.organizationId,
    preserveStripeBinding: disposition.preserveStripeBinding,
    reconcileSeats: !disposition.skipSeatReconciliation,
    transition: disposition.transition,
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
  // Ignorable events do not consult Stripe or trust its mutable orgId.
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
  const stripeTierUnresolved =
    initialTransition.kind === "grant" &&
    stripeResolution.kind === "resolved" &&
    (stripeResolution.priceId === null || stripeResolution.seatCount === null);
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
      allowSandboxEvents: classificationOptions.allowSandboxEvents,
      event,
      executor: tx,
      now,
      organizationId,
      stripeResolution,
      stripeTierUnresolved,
      transition,
    }),
  );
  logUnappliedRevenueCatGrant(event, outcome);
  return outcome;
}
