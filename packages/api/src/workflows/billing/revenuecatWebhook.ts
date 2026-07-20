import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingStatus,
  organizationBilling,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { and, eq, gt } from "drizzle-orm";
import {
  classifyRevenueCatEvent,
  type RevenueCatBillingTransition,
  resolveOrganizationIdFromEvent,
  resolveStripeStoreOrganizationId,
  type StripeStoreOrgResolution,
} from "../../billing/revenuecatWebhook";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";

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

async function isOrganizationAdmin(
  executor: DatabaseSession,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  try {
    await requireDirectOrganizationAccess({
      executor,
      organizationId,
      requireAdmin: true,
      userId,
    });
    return true;
  } catch (error) {
    if (error instanceof OrganizationManagerError) {
      return false;
    }
    throw error;
  }
}

/**
 * Loads the org's billing row and, on Postgres, takes a `FOR UPDATE` row lock on
 * it. The lock serializes concurrent webhook transactions for the SAME org:
 * without it, two events racing could both pass {@link hasNewerAppliedEvent} and
 * commit out of order (last write wins regardless of event time). SQLite writes
 * are already serialized, so the lock is Postgres-only.
 */
async function lockBillingProviderCustomerId(
  executor: DatabaseSession,
  organizationId: string,
): Promise<{ providerCustomerId: string | null } | undefined> {
  const lockQuery = executor
    .select({ providerCustomerId: organizationBilling.providerCustomerId })
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
): Promise<string | null> {
  if (transition.kind === "ignore") {
    return transition.reason;
  }
  if (organizationId === null) {
    return "Event carried no organization id";
  }

  // Lock the billing row first so concurrent same-org events serialize; the
  // stale-event check below is only race-safe while the row is held.
  const billing = await lockBillingProviderCustomerId(executor, organizationId);
  if (!billing) {
    return "Unknown organization";
  }

  // Reject stale, out-of-order deliveries: if a newer event has already been
  // *applied* to this org, do not let this older event overwrite it (e.g. a
  // retried EXPIRATION arriving after the RENEWAL that superseded it). Only
  // applied events count, so an ignored/test event can never block a real one.
  if (await hasNewerAppliedEvent(executor, organizationId, event)) {
    return "A newer billing event has already been applied";
  }

  // Binding a new RevenueCat customer to an org requires the buyer to be an
  // admin; renewals for an already-bound customer skip the re-check.
  if (
    transition.kind === "grant" &&
    billing.providerCustomerId !== event.app_user_id &&
    !(await isOrganizationAdmin(executor, organizationId, event.app_user_id))
  ) {
    return "Buyer is not an organization admin";
  }

  return null;
}

/**
 * Applies a RevenueCat webhook event to organization sync billing.
 *
 * Idempotent on the provider event id: the event is claimed by inserting its id
 * (a duplicate delivery inserts nothing and re-applies nothing). The billing
 * effect is computed purely by {@link classifyRevenueCatEvent}; the target org
 * comes from the event's `orgId` subscriber attribute. Binding a new RevenueCat
 * customer to an org additionally requires the buyer (App User ID) to be an org
 * admin — a non-admin buyer is recorded and ignored rather than granted. All
 * work happens in one transaction so the idempotency claim gates the billing
 * write.
 */
export async function runRevenueCatWebhookWorkflow(
  db: ApiDatabase,
  event: RevenueCatWebhookEvent,
  now: Date = new Date(),
  deps: { stripe?: StripeApiDeps } = {},
): Promise<RevenueCatWebhookOutcome> {
  const transition = classifyRevenueCatEvent(event, now);
  // Stripe-store events use the immutable per-subscription org binding — the
  // customer-level attribute could have been rebound by a later purchase for
  // another org. A FAILED lookup on an event that would change billing must
  // defer (never fall back to the attribute, never claim the event id) so a
  // redelivery can attribute it correctly.
  // Ignorable events never consult Stripe: their org is only recorded, and
  // the mutable-attribute risk applies to billing CHANGES, not audit rows.
  const stripeResolution =
    transition.kind === "ignore"
      ? ({ kind: "none" } satisfies StripeStoreOrgResolution)
      : await resolveStripeStoreOrganizationId(event, deps.stripe ?? {});
  if (stripeResolution.kind === "error") {
    return {
      status: "retry",
      reason: "Stripe subscription lookup failed for a Stripe-store event",
    };
  }
  const organizationId =
    stripeResolution.kind === "resolved"
      ? stripeResolution.organizationId
      : resolveOrganizationIdFromEvent(event);

  return db.transaction(async (tx) => {
    const ignoredReason = await resolveIgnoredReason(
      tx,
      transition,
      organizationId,
      event,
    );

    // Claim the event id. A second delivery of the same id inserts nothing.
    const [claimed] = await tx
      .insert(revenuecatWebhookEvents)
      .values({
        eventId: event.id,
        eventType: event.type,
        appUserId: event.app_user_id,
        productId: event.product_id ?? null,
        transactionId: event.transaction_id ?? null,
        originalTransactionId: event.original_transaction_id ?? null,
        organizationId,
        outcome: ignoredReason ? "ignored" : "applied",
        eventTimestamp: new Date(event.event_timestamp_ms),
        purchasedAt:
          event.purchased_at_ms != null
            ? new Date(event.purchased_at_ms)
            : null,
        expirationAt:
          event.expiration_at_ms != null
            ? new Date(event.expiration_at_ms)
            : null,
      })
      .onConflictDoNothing({ target: revenuecatWebhookEvents.eventId })
      .returning({ id: revenuecatWebhookEvents.id });

    if (!claimed) {
      return { status: "duplicate" };
    }
    if (ignoredReason) {
      return { status: "ignored", reason: ignoredReason };
    }

    // Applied path: resolveIgnoredReason returned null, so the event is a
    // grant/revoke against a resolved organization. These narrowing guards are
    // unreachable here, but keep them accurate rather than misleading.
    if (transition.kind === "ignore") {
      return { status: "ignored", reason: transition.reason };
    }
    if (organizationId === null) {
      return { status: "ignored", reason: "Event carried no organization id" };
    }

    await tx
      .update(organizationBilling)
      .set({ ...transition.fields, updatedAt: now })
      .where(eq(organizationBilling.organizationId, organizationId));
    if (transition.kind === "grant") {
      await reconcileOrganizationBillingSeats({
        executor: tx,
        now,
        organizationId,
        source: {
          sourceId: event.id,
          sourceType: "provider_event",
        },
      });
    }

    return {
      status: "applied",
      organizationId,
      billingStatus: transition.fields.status,
    };
  });
}
