import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingSeatAssignments,
  organizationBillingSeatEvents,
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
  users,
} from "@tearleads/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  LAPSED_BILLING_PURGE_GRACE_MS,
  organizationSeatPeriodKey,
} from "../../billing/organizationBilling";
import type { ActiveNativeSubscription } from "../../billing/revenueCatApi";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";
import { hasStripeBindingIdentity } from "./stripeBindingPolicy";

interface NativeSubscriptionOwner {
  readonly organizationId: string;
}

async function requirePersonalOrganization(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly userId: string;
}): Promise<void> {
  const [user] = await input.executor
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user || user.defaultOrganizationId !== input.organizationId) {
    throw new OrganizationManagerError(
      "Native subscriptions can only be assigned to a personal organization",
      409,
    );
  }
}

async function lockBilling(executor: DatabaseSession, organizationId: string) {
  const query = executor
    .select({
      organizationId: organizationBilling.organizationId,
      provider: organizationBilling.provider,
      providerCustomerId: organizationBilling.providerCustomerId,
      providerProductId: organizationBilling.providerProductId,
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId))
    .limit(1);
  const [billing] = isSqliteApiDatabase()
    ? await query
    : await query.for("update");
  if (!billing) {
    throw new OrganizationManagerError("Organization billing not found", 404);
  }
  return billing;
}

async function findCurrentOwner(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly subscriptionId: string;
}): Promise<NativeSubscriptionOwner | null> {
  const query = input.executor
    .select({ organizationId: organizationBilling.organizationId })
    .from(organizationBilling)
    .where(
      and(
        eq(organizationBilling.provider, "revenuecat"),
        eq(organizationBilling.providerSubscriptionId, input.subscriptionId),
        ne(organizationBilling.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const [owner] = isSqliteApiDatabase()
    ? await query
    : await query.for("update");
  return owner ?? null;
}

async function assertNoStripeBinding(
  executor: DatabaseSession,
  organizationId: string,
): Promise<void> {
  const [binding] = await executor
    .select({
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId))
    .limit(1);
  if (hasStripeBindingIdentity(binding)) {
    throw new OrganizationManagerError(
      "Cancel the organization's web subscription before moving a native subscription",
      409,
    );
  }
}

async function disablePreviousOwner(input: {
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string;
}): Promise<void> {
  await input.executor
    .update(organizationBilling)
    .set({
      currentPeriodEndsAt: null,
      currentPeriodStartsAt: null,
      disabledAt: input.now,
      entitlementId: null,
      provider: null,
      providerCustomerId: null,
      providerProductId: null,
      providerSubscriptionId: null,
      providerTransactionId: null,
      purgeAfter: new Date(input.now.getTime() + LAPSED_BILLING_PURGE_GRACE_MS),
      seatCount: 0,
      seatPeriodKey: null,
      status: "disabled",
      trialEndsAt: null,
      updatedAt: input.now,
    })
    .where(eq(organizationBilling.organizationId, input.organizationId));
}

async function releasePreviousOwnerSeats(input: {
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string;
  readonly sourceId: string;
}): Promise<void> {
  const assignments = await input.executor
    .select({
      billingPeriodEndsAt:
        organizationBillingSeatAssignments.billingPeriodEndsAt,
      billingPeriodStartsAt:
        organizationBillingSeatAssignments.billingPeriodStartsAt,
      id: organizationBillingSeatAssignments.id,
      userId: organizationBillingSeatAssignments.userId,
    })
    .from(organizationBillingSeatAssignments)
    .where(
      and(
        eq(
          organizationBillingSeatAssignments.organizationId,
          input.organizationId,
        ),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    );
  if (assignments.length === 0) return;
  await input.executor
    .update(organizationBillingSeatAssignments)
    .set({
      releasedAt: input.now,
      releaseSourceId: input.sourceId,
      releaseSourceType: "provider_event",
      updatedAt: input.now,
    })
    .where(
      inArray(
        organizationBillingSeatAssignments.id,
        assignments.map((assignment) => assignment.id),
      ),
    );
  const events: Array<typeof organizationBillingSeatEvents.$inferInsert> =
    assignments.map((assignment) => ({
      activeSeatCount: 0,
      billingPeriodEndsAt: assignment.billingPeriodEndsAt,
      billingPeriodStartsAt: assignment.billingPeriodStartsAt,
      eventType: "seat_released",
      licensedSeatCount: 0,
      organizationId: input.organizationId,
      quantityDelta: 0,
      sourceId: input.sourceId,
      sourceType: "provider_event",
      userId: assignment.userId,
    }));
  await input.executor.insert(organizationBillingSeatEvents).values(events);
}

async function activateNewOwner(input: {
  readonly appUserId: string;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string;
  readonly seatCount: number;
  readonly subscription: ActiveNativeSubscription;
}): Promise<void> {
  const seatPeriodKey = organizationSeatPeriodKey({
    currentPeriodEndsAt: input.subscription.currentPeriodEndsAt,
    currentPeriodStartsAt: input.subscription.currentPeriodStartsAt,
    status: "active",
    trialEndsAt: null,
  });
  await input.executor
    .update(organizationBilling)
    .set({
      checkoutAttemptExpiresAt: null,
      checkoutAttemptId: null,
      checkoutAttemptMode: null,
      checkoutAttemptSeatQuantity: null,
      checkoutAttemptStartedAt: null,
      checkoutAttemptUserId: null,
      currentPeriodEndsAt: input.subscription.currentPeriodEndsAt,
      currentPeriodStartsAt: input.subscription.currentPeriodStartsAt,
      disabledAt: null,
      entitlementId: "sync",
      provider: "revenuecat",
      providerCustomerId: input.appUserId,
      providerProductId: input.subscription.productId,
      providerSubscriptionId: input.subscription.subscriptionId,
      providerTransactionId: input.subscription.subscriptionId,
      purgeAfter: null,
      purgeStartedAt: null,
      purgedAt: null,
      seatCount: input.seatCount,
      seatPeriodKey,
      status: "active",
      trialEndsAt: null,
      updatedAt: input.now,
    })
    .where(eq(organizationBilling.organizationId, input.organizationId));
}

async function applyNativeSubscriptionClaim(input: {
  readonly appUserId: string;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly subscription: ActiveNativeSubscription;
  readonly target: Awaited<ReturnType<typeof lockBilling>>;
}): Promise<{ readonly sourceOrganizationId: string | null }> {
  const tier = getSyncBillingTierForNativeProduct(input.subscription.productId);
  if (!tier) {
    throw new OrganizationManagerError(
      "The native subscription product is not configured for sync billing",
      409,
    );
  }
  await assertNoStripeBinding(input.executor, input.organizationId);
  if (
    input.target.providerSubscriptionId !== null &&
    input.target.providerSubscriptionId !== input.subscription.subscriptionId
  ) {
    throw new OrganizationManagerError(
      "The personal organization already has a different subscription",
      409,
    );
  }
  if (
    input.target.providerProductId !== null &&
    getSyncBillingTierForNativeProduct(input.target.providerProductId) === null
  ) {
    throw new OrganizationManagerError(
      "Cancel the organization's existing subscription before moving a native subscription",
      409,
    );
  }

  const source = await findCurrentOwner({
    executor: input.executor,
    organizationId: input.organizationId,
    subscriptionId: input.subscription.subscriptionId,
  });
  if (source) {
    await disablePreviousOwner({
      executor: input.executor,
      now: input.now,
      organizationId: source.organizationId,
    });
    await releasePreviousOwnerSeats({
      executor: input.executor,
      now: input.now,
      organizationId: source.organizationId,
      sourceId: input.sourceId,
    });
  }
  await activateNewOwner({
    appUserId: input.appUserId,
    executor: input.executor,
    now: input.now,
    organizationId: input.organizationId,
    seatCount: tier.seatLimit,
    subscription: input.subscription,
  });

  await reconcileOrganizationBillingSeats({
    executor: input.executor,
    now: input.now,
    organizationId: input.organizationId,
    source: {
      sourceId: input.sourceId,
      sourceType: "provider_event",
    },
  });
  return { sourceOrganizationId: source?.organizationId ?? null };
}

/** Authorizes the API call before the provider request runs outside a DB tx. */
export async function runAuthorizeNativeSubscriptionClaimWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      requireAdmin: true,
      userId: sessionUserId,
    });
    await requirePersonalOrganization({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });
  });
}

/** A transfer webhook arrived before the signed-in claim established intent. */
export class NativeSubscriptionTransferAwaitingClaimError extends Error {}

function targetOwnsNativeSubscription(input: {
  readonly appUserId: string;
  readonly subscription: ActiveNativeSubscription;
  readonly target: Awaited<ReturnType<typeof lockBilling>>;
}): boolean {
  return (
    input.target.provider === "revenuecat" &&
    input.target.providerCustomerId === input.appUserId &&
    input.target.providerProductId === input.subscription.productId &&
    input.target.providerSubscriptionId === input.subscription.subscriptionId &&
    input.target.status === "active"
  );
}

/** Revalidates policy and atomically moves a verified native subscription. */
export async function runClaimNativeSubscriptionWorkflow(input: {
  readonly appUserId: string;
  readonly auditEvent?: {
    readonly eventId: string;
    readonly eventTimestamp: Date;
  };
  readonly db: ApiDatabase;
  readonly now?: Date;
  readonly organizationId: string;
  readonly recordAlreadyOwnedAudit?: boolean;
  readonly requireExistingBinding?: boolean;
  readonly requireSessionAccess: boolean;
  readonly sourceId: string;
  readonly subscription: ActiveNativeSubscription;
}): Promise<{
  readonly duplicate: boolean;
  readonly sourceOrganizationId: string | null;
}> {
  return input.db.transaction(async (tx) => {
    if (input.requireSessionAccess) {
      await requireDirectOrganizationAccess({
        executor: tx,
        organizationId: input.organizationId,
        requireAdmin: true,
        userId: input.appUserId,
      });
    }
    await requirePersonalOrganization({
      executor: tx,
      organizationId: input.organizationId,
      userId: input.appUserId,
    });
    const target = await lockBilling(tx, input.organizationId);
    const alreadyOwned = targetOwnsNativeSubscription({
      appUserId: input.appUserId,
      subscription: input.subscription,
      target,
    });
    if (input.requireExistingBinding && !alreadyOwned) {
      throw new NativeSubscriptionTransferAwaitingClaimError();
    }
    if (input.recordAlreadyOwnedAudit === false && alreadyOwned) {
      return { duplicate: true, sourceOrganizationId: null };
    }
    if (input.auditEvent) {
      const [claimed] = await tx
        .insert(revenuecatWebhookEvents)
        .values({
          appUserId: input.appUserId,
          eventId: input.auditEvent.eventId,
          eventTimestamp: input.auditEvent.eventTimestamp,
          eventType: "TRANSFER",
          expirationAt: input.subscription.currentPeriodEndsAt,
          organizationId: input.organizationId,
          outcome: "applied",
          productId: input.subscription.productId,
          store: input.subscription.store.toUpperCase(),
          purchasedAt: input.subscription.currentPeriodStartsAt,
          transactionId: input.subscription.subscriptionId,
          originalTransactionId: input.subscription.subscriptionId,
        })
        .onConflictDoNothing({ target: revenuecatWebhookEvents.eventId })
        .returning({ id: revenuecatWebhookEvents.id });
      if (!claimed) {
        return { duplicate: true, sourceOrganizationId: null };
      }
    }
    const applied = await applyNativeSubscriptionClaim({
      appUserId: input.appUserId,
      executor: tx,
      now: input.now ?? new Date(),
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      subscription: input.subscription,
      target,
    });
    if (input.auditEvent && applied.sourceOrganizationId) {
      await tx
        .update(revenuecatWebhookEvents)
        .set({ sourceOrganizationId: applied.sourceOrganizationId })
        .where(eq(revenuecatWebhookEvents.eventId, input.auditEvent.eventId));
    }
    return { duplicate: false, ...applied };
  });
}

export async function resolvePersonalOrganizationForUser(
  db: ApiDatabase,
  userId: string,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ organizationId: users.defaultOrganizationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user?.organizationId ?? null;
  });
}
