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
} from "../../billing/revenuecatWebhook";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";

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
  | { status: "duplicate" };

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

async function loadBillingProviderCustomerId(
  executor: DatabaseSession,
  organizationId: string,
): Promise<{ providerCustomerId: string | null } | undefined> {
  const [row] = await executor
    .select({ providerCustomerId: organizationBilling.providerCustomerId })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId))
    .limit(1);
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

  const billing = await loadBillingProviderCustomerId(executor, organizationId);
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
): Promise<RevenueCatWebhookOutcome> {
  const transition = classifyRevenueCatEvent(event, now);
  const organizationId = resolveOrganizationIdFromEvent(event);

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
        organizationId,
        outcome: ignoredReason ? "ignored" : "applied",
        eventTimestamp: new Date(event.event_timestamp_ms),
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
    // grant/revoke against a resolved organization.
    if (transition.kind === "ignore" || organizationId === null) {
      return { status: "ignored", reason: "Event carried no organization id" };
    }

    await tx
      .update(organizationBilling)
      .set({ ...transition.fields, updatedAt: now })
      .where(eq(organizationBilling.organizationId, organizationId));

    return {
      status: "applied",
      organizationId,
      billingStatus: transition.fields.status,
    };
  });
}
