import type {
  ApiDatabase,
  DatabaseSession,
} from "@symcrypt/api-shared/postgres";
import {
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
} from "@symcrypt/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { eq } from "drizzle-orm";
import { allowsRevenueCatSandboxEvents } from "../../billing/revenueCatConfig";
import { resolveRevenueCatFinancialAuditFields } from "../../billing/revenuecatFinancials";
import {
  BOUND_REVENUECAT_PRODUCT_CHANGE_REQUIRED_REASON,
  BOUND_REVENUECAT_TIER_REQUIRED_REASON,
  classifyRevenueCatEvent,
  isRevenueCatGrantEventType,
  type RevenueCatBillingTransition,
  resolveRevenueCatRecordedProductId,
  SANDBOX_IGNORED_REASON,
  UNCONFIGURED_SYNC_BILLING_TIER_REASON,
} from "../../billing/revenuecatWebhook";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { resolveBoundRevenueCatTransition } from "./revenuecatGrantCapacity";
import { resolveRevenueCatWebhookOrganizationId } from "./revenuecatOrganizationRouting";
import { resolveNativeStripeConflictReason } from "./revenuecatProviderConflict";
import {
  type ImmutableStripeStoreOrgResolution,
  type LockedBillingIdentity,
  resolveImmutableStripeStoreOrganizationId,
  validateLockedStripeStoreOrganizationId,
} from "./revenuecatStripeResolution";
import { applyRevenueCatTransition } from "./revenuecatWebhookApplication";
import { logUnappliedRevenueCatPaidEvent } from "./revenuecatWebhookLogging";
import { resolveLifecycleOwnershipConflict } from "./revenuecatWebhookOwnership";
import {
  isStripeEventSupersededByNative,
  lockRevenueCatBillingIdentity,
  resolveLockedStripeTierFallback,
  resolveRevenueCatIgnoredReason,
  SUPERSEDED_STRIPE_EVENT_REASON,
  UNRESOLVED_STRIPE_TIER_REASON,
} from "./revenuecatWebhookPolicy";
import type { RevenueCatWebhookOutcome } from "./revenuecatWebhookTypes";

export type { RevenueCatWebhookOutcome } from "./revenuecatWebhookTypes";

/**
 * Disposition of a processed RevenueCat webhook event:
 * - `applied`: the org's billing row was updated to `billingStatus`.
 * - `ignored`: the event was recorded but changed nothing (unhandled type,
 *   no/unknown org, or a non-admin buyer).
 * - `duplicate`: the event id was already processed; nothing was re-applied.
 */
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
  return {
    deleteStripeBinding: false,
    ignoredReason: null,
    kind: "continue",
    preserveStripeBinding: nativeStripeConflict !== null,
    skipSeatReconciliation:
      input.skipSeatReconciliation || nativeStripeConflict !== null,
    transition: input.transition,
    warning:
      [input.warning, nativeStripeConflict]
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

function unconfiguredGrantRetry(
  event: RevenueCatWebhookEvent,
  transition: RevenueCatBillingTransition,
): PreclaimDisposition | null {
  const shouldRetry =
    transition.kind === "ignore" &&
    transition.reason === UNCONFIGURED_SYNC_BILLING_TIER_REASON &&
    isRevenueCatGrantEventType(event.type);
  if (!shouldRetry) return null;
  console.error(
    `RevenueCat paid grant ${event.id} was not applied: ${UNCONFIGURED_SYNC_BILLING_TIER_REASON}`,
  );
  return { kind: "retry", reason: UNCONFIGURED_SYNC_BILLING_TIER_REASON };
}

async function stripeBindingChanged(
  input: RevenueCatPreclaimInput,
  billing: LockedBillingIdentity | undefined,
): Promise<boolean> {
  return input.stripeResolution.kind === "resolved" && billing
    ? !(await validateLockedStripeStoreOrganizationId({
        billing,
        event: input.event,
        executor: input.executor,
        resolution: input.stripeResolution,
      }))
    : false;
}

async function resolvePreclaimDisposition(
  input: RevenueCatPreclaimInput,
): Promise<PreclaimDisposition> {
  const billing =
    (input.transition.kind !== "ignore" ||
      input.transition.reason === BOUND_REVENUECAT_TIER_REQUIRED_REASON ||
      input.transition.reason ===
        BOUND_REVENUECAT_PRODUCT_CHANGE_REQUIRED_REASON) &&
    input.organizationId !== null
      ? await lockRevenueCatBillingIdentity(
          input.executor,
          input.organizationId,
        )
      : undefined;
  let transition = resolveBoundRevenueCatTransition({
    allowSandboxEvents: input.allowSandboxEvents,
    billing,
    event: input.event,
    now: input.now,
    transition: input.transition,
  });
  const grantRetry = unconfiguredGrantRetry(input.event, transition);
  if (grantRetry) return grantRetry;
  if (await stripeBindingChanged(input, billing)) {
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
  const financials = resolveRevenueCatFinancialAuditFields(input.event);
  const [claimed] = await input.executor
    .insert(revenuecatWebhookEvents)
    .values({
      eventId: input.event.id,
      eventType: input.event.type,
      appUserId: input.event.app_user_id,
      productId: resolveRevenueCatRecordedProductId(input.event),
      store: input.event.store?.toUpperCase() ?? null,
      ...financials,
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
  const organizationId = await resolveRevenueCatWebhookOrganizationId({
    db,
    event,
    stripeResolution,
  });

  let outcome: RevenueCatWebhookOutcome;
  try {
    outcome = await db.transaction((tx) =>
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
  } catch (error) {
    const ownershipOutcome = await resolveLifecycleOwnershipConflict({
      db,
      error,
      event,
      organizationId,
      transition,
    });
    if (ownershipOutcome) return ownershipOutcome;
    throw error;
  }
  logUnappliedRevenueCatPaidEvent(event, outcome);
  return outcome;
}
