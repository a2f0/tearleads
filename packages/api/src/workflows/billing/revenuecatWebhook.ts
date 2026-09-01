import type {
  ApiDatabase,
  DatabaseSession,
} from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
} from "@symcrypt/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { and, eq } from "drizzle-orm";
import { resolveRevenueCatFinancialAuditFields } from "../../billing/revenuecatFinancials";
import {
  BOUND_REVENUECAT_PRODUCT_CHANGE_REQUIRED_REASON,
  BOUND_REVENUECAT_TIER_REQUIRED_REASON,
  isRevenueCatGrantEventType,
  type RevenueCatBillingTransition,
  resolveRevenueCatRecordedProductId,
  UNCONFIGURED_SYNC_BILLING_TIER_REASON,
} from "../../billing/revenuecatWebhook";
import { isRecognizedNativeRevenueCatStore } from "./revenuecatBuyerPolicy";
import { resolveBoundRevenueCatTransition } from "./revenuecatGrantCapacity";
import {
  resolveNativeGrantDisposition,
  resolveNativeProductChangeConflict,
} from "./revenuecatNativeBindingPolicy";
import { resolveRevenueCatWebhookOrganizationId } from "./revenuecatOrganizationRouting";
import type { VerifiedPlayReplacement } from "./revenuecatPlayReplacement";
import {
  type ImmutableStripeStoreOrgResolution,
  type LockedBillingIdentity,
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
import {
  type RevenueCatWebhookWorkflowDeps,
  resolveRevenueCatWebhookPreflight,
} from "./revenuecatWebhookPreflight";
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
  readonly verifiedReplacement: VerifiedPlayReplacement | null;
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

function ignoredPreclaimDisposition(
  ignoredReason: string,
  transition: RevenueCatBillingTransition,
): PreclaimDisposition {
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

async function nativeBindingChanged(
  input: RevenueCatPreclaimInput,
  billing: LockedBillingIdentity | undefined,
): Promise<boolean> {
  const subscriptionId = input.event.original_transaction_id;
  if (
    !billing ||
    input.organizationId === null ||
    !subscriptionId ||
    !isRecognizedNativeRevenueCatStore(input.event.store) ||
    (billing.provider === "revenuecat" &&
      billing.providerSubscriptionId === subscriptionId)
  ) {
    return false;
  }
  const [owner] = await input.executor
    .select({ organizationId: organizationBilling.organizationId })
    .from(organizationBilling)
    .where(
      and(
        eq(organizationBilling.provider, "revenuecat"),
        eq(organizationBilling.providerSubscriptionId, subscriptionId),
      ),
    )
    .limit(1);
  return owner !== undefined && owner.organizationId !== input.organizationId;
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
  if (await nativeBindingChanged(input, billing)) {
    return {
      kind: "retry",
      reason: "Native binding changed before RevenueCat event application",
    };
  }
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
    ...input,
    billing,
    transition,
  });
  if (ignoredReason) {
    return ignoredPreclaimDisposition(ignoredReason, transition);
  }
  const productChangeConflict = await resolveNativeProductChangeConflict({
    ...input,
    billing,
    transition,
  });
  if (productChangeConflict) {
    return { kind: "retry", reason: productChangeConflict };
  }
  return resolveNativeGrantDisposition({
    ...input,
    billing,
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
  const [sourceBilling] =
    input.event.type === "PRODUCT_CHANGE" &&
    input.event.store?.toUpperCase() === "PLAY_STORE" &&
    input.organizationId !== null
      ? await input.executor
          .select({
            subscriptionId: organizationBilling.providerSubscriptionId,
          })
          .from(organizationBilling)
          .where(eq(organizationBilling.organizationId, input.organizationId))
          .limit(1)
      : [];
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
      sourceOriginalTransactionId: sourceBilling?.subscriptionId ?? null,
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

async function isRevenueCatEventClaimed(
  executor: DatabaseSession,
  eventId: string,
): Promise<boolean> {
  const [claimed] = await executor
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId))
    .limit(1);
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
  readonly verifiedReplacement: VerifiedPlayReplacement | null;
}): Promise<RevenueCatWebhookOutcome> {
  if (await isRevenueCatEventClaimed(input.executor, input.event.id)) {
    return { status: "duplicate" };
  }
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

/** Applies one authenticated RevenueCat event idempotently and atomically. */
export async function runRevenueCatWebhookWorkflow(
  db: ApiDatabase,
  event: RevenueCatWebhookEvent,
  now: Date = new Date(),
  deps: RevenueCatWebhookWorkflowDeps = {},
): Promise<RevenueCatWebhookOutcome> {
  const preflight = await resolveRevenueCatWebhookPreflight({
    db,
    deps,
    event,
    now,
  });
  if (preflight.kind === "retry") {
    return { status: "retry", reason: preflight.reason };
  }
  const {
    allowSandboxEvents,
    stripeResolution,
    stripeTierUnresolved,
    transition,
    verifiedReplacement,
  } = preflight;
  let organizationId: string | null = null;
  let outcome: RevenueCatWebhookOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      organizationId = await resolveRevenueCatWebhookOrganizationId({
        db: tx,
        event,
        stripeResolution,
        verifiedReplacement,
      });
      return runRevenueCatWebhookTransaction({
        allowSandboxEvents,
        event,
        executor: tx,
        now,
        organizationId,
        stripeResolution,
        stripeTierUnresolved,
        transition,
        verifiedReplacement,
      });
    });
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
