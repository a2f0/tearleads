import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingProvider,
  type OrganizationBillingStatus,
  organizationBilling,
  organizationBillingStripeSeats,
  organizationRosterEntries,
  organizations,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import { and, desc, eq, gt, gte, inArray } from "drizzle-orm";
import {
  createTrialBillingFields,
  type OrganizationBilling,
  organizationSeatPeriodKey,
} from "../../billing/organizationBilling";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";
import { withOrganizationAdminTransaction } from "../organizations/mutationAccess";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";
import {
  loadOrganizationBilling,
  type OrganizationBillingRow,
  resolveOrganizationBilling,
} from "./organizationBillingState";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";
import { loadOrganizationBillingSeatUsage } from "./organizationSeatUsage";
import {
  freeTrialLifecycleSourceId,
  recordFreeTrialInitialized,
} from "./organizationTrialLifecycle";
import {
  hasActiveStripeBinding,
  hasStripeBindingIdentity,
} from "./stripeBindingPolicy";

/**
 * Starts an organization's free sync trial. Admin-only. A `local` organization
 * transitions to `trialing`; an already `trialing`/`active` organization is
 * returned unchanged (idempotent); a lapsed organization (`past_due`,
 * `disabled`, `deleting`, `purged`) cannot re-trial and must subscribe.
 */
async function startOrganizationTrialInTransaction(input: {
  executor: DatabaseSession;
  now: Date;
  organizationId: string;
  sessionUserId: string;
}): Promise<OrganizationBilling> {
  await requireDirectOrganizationAccess({
    executor: input.executor,
    organizationId: input.organizationId,
    requireAdmin: true,
    userId: input.sessionUserId,
  });

  const billing = await resolveOrganizationBilling(
    input.executor,
    input.organizationId,
    input.now,
  );
  if (billing.status === "trialing" || billing.status === "active") {
    return billing;
  }
  if (billing.status !== "local") {
    throw new OrganizationManagerError(
      "Organization trial is no longer available",
      409,
    );
  }

  const { status, trialEndsAt } = createTrialBillingFields(input.now);
  const seatPeriodKey = organizationSeatPeriodKey({
    currentPeriodEndsAt: null,
    currentPeriodStartsAt: null,
    status,
    trialEndsAt,
  });
  const [updated] = await input.executor
    .update(organizationBilling)
    .set({
      status,
      trialEndsAt,
      seatPeriodKey,
      trialExpiryAttemptCount: 0,
      trialExpiryLastError: null,
      trialExpiryNextAttemptAt: trialEndsAt,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(organizationBilling.organizationId, input.organizationId),
        eq(organizationBilling.status, "local"),
      ),
    )
    .returning({ organizationId: organizationBilling.organizationId });

  if (!updated) {
    return loadOrganizationBilling(input.executor, input.organizationId);
  }

  const sourceId = freeTrialLifecycleSourceId(
    input.organizationId,
    trialEndsAt,
  );
  await reconcileOrganizationBillingSeats({
    executor: input.executor,
    now: input.now,
    organizationId: input.organizationId,
    source: {
      sourceId,
      sourceType: "billing_transition",
    },
  });
  await recordFreeTrialInitialized({
    executor: input.executor,
    organizationId: input.organizationId,
    sourceId,
    trialEndsAt,
    trialStartedAt: input.now,
  });

  return loadOrganizationBilling(input.executor, input.organizationId);
}

export async function runGetOrganizationBillingWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  now: Date = new Date(),
): Promise<{
  readonly activeMemberCount: number;
  readonly assignedSeatCount: number;
  readonly assignedUserIds: readonly string[];
  readonly billing: OrganizationBilling;
  readonly currentUserHasSyncSeat: boolean;
  readonly pendingSeatCount: number | null;
}> {
  return db.transaction(async (tx) => {
    const billing = await resolveOrganizationBilling(tx, organizationId, now);
    if (billing.status === "deleting" || billing.status === "purged") {
      const [retainedMember] = await tx
        .select({ id: organizationRosterEntries.id })
        .from(organizationRosterEntries)
        .where(
          and(
            eq(organizationRosterEntries.organizationId, organizationId),
            eq(organizationRosterEntries.userId, sessionUserId),
            eq(organizationRosterEntries.status, "active"),
          ),
        )
        .limit(1);
      if (!retainedMember) {
        throw new OrganizationManagerError("Organization access denied", 403);
      }
    } else {
      await requireDirectOrganizationAccess({
        executor: tx,
        organizationId,
        userId: sessionUserId,
      });
    }
    const activeMemberCount = await countActiveOrganizationMembers(
      tx,
      organizationId,
    );
    const pendingSeatCount = await resolvePendingNativeSeatCount(
      tx,
      organizationId,
      billing,
    );
    const seatUsage = await loadOrganizationBillingSeatUsage({
      executor: tx,
      organizationId,
      sessionUserId,
    });
    return { activeMemberCount, billing, pendingSeatCount, ...seatUsage };
  });
}

const PENDING_CHANGE_RESOLUTION_EVENT_TYPES = [
  "INITIAL_PURCHASE",
  "EXPIRATION",
  "SUBSCRIPTION_PAUSED",
  "TRANSFER",
] as const;
const PENDING_CHANGE_WITHOUT_PERIOD_START_RESOLUTION_EVENT_TYPES = [
  ...PENDING_CHANGE_RESOLUTION_EVENT_TYPES,
  "RENEWAL",
] as const;

/**
 * Latest accepted PRODUCT_CHANGE that its destination's effective event has
 * not consumed. This is a greenfield contract: every stored PRODUCT_CHANGE
 * row uses its destination product id; legacy audit-row semantics are not
 * supported.
 */
async function resolvePendingNativeSeatCount(
  executor: DatabaseSession,
  organizationId: string,
  billing: OrganizationBillingRow,
): Promise<number | null> {
  if (billing.status !== "active") return null;
  const currentTier = getSyncBillingTierForNativeProduct(
    billing.providerProductId,
  );
  if (!currentTier || currentTier.seatLimit !== billing.seatCount) return null;
  if (billing.providerCustomerId === null) return null;

  const [change] = await executor
    .select({
      occurredAt: revenuecatWebhookEvents.eventTimestamp,
      productId: revenuecatWebhookEvents.productId,
    })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.organizationId, organizationId),
        eq(revenuecatWebhookEvents.eventType, "PRODUCT_CHANGE"),
        eq(revenuecatWebhookEvents.outcome, "applied"),
        eq(revenuecatWebhookEvents.appUserId, billing.providerCustomerId),
        billing.currentPeriodStartsAt
          ? gte(
              revenuecatWebhookEvents.eventTimestamp,
              billing.currentPeriodStartsAt,
            )
          : undefined,
      ),
    )
    .orderBy(
      desc(revenuecatWebhookEvents.eventTimestamp),
      desc(revenuecatWebhookEvents.createdAt),
      desc(revenuecatWebhookEvents.id),
    )
    .limit(1);
  const pendingTier = getSyncBillingTierForNativeProduct(change?.productId);
  if (!change || !pendingTier || pendingTier.id === currentTier.id) return null;

  const [resolution] = await executor
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.organizationId, organizationId),
        eq(revenuecatWebhookEvents.outcome, "applied"),
        eq(revenuecatWebhookEvents.appUserId, billing.providerCustomerId),
        gt(revenuecatWebhookEvents.eventTimestamp, change.occurredAt),
        inArray(
          revenuecatWebhookEvents.eventType,
          billing.currentPeriodStartsAt === null
            ? PENDING_CHANGE_WITHOUT_PERIOD_START_RESOLUTION_EVENT_TYPES
            : PENDING_CHANGE_RESOLUTION_EVENT_TYPES,
        ),
      ),
    )
    .orderBy(
      desc(revenuecatWebhookEvents.eventTimestamp),
      desc(revenuecatWebhookEvents.createdAt),
      desc(revenuecatWebhookEvents.id),
    )
    .limit(1);
  return resolution ? null : pendingTier.seatLimit;
}

async function countActiveOrganizationMembers(
  executor: DatabaseSession,
  organizationId: string,
): Promise<number> {
  const [organization] = await executor
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) {
    throw new OrganizationManagerError("Organization not found", 404);
  }
  return (
    await listUsersReachableFromCurrentGroup({
      executor,
      groupId: organization.memberGroupId,
    })
  ).length;
}

/**
 * Reads the provider customer reference an organization's manage-subscription
 * link needs — the billing provider and the provider-side customer id. Admin
 * only, since managing/cancelling a subscription is an admin action (unlike the
 * billing GET, which any direct member may read). Returns the raw ids so the
 * service layer can perform the provider lookup OUTSIDE this transaction — an
 * external HTTP call must never run while the DB transaction (and its locks) is
 * open.
 */
export async function runResolveOrganizationBillingCustomerWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<{
  provider: OrganizationBillingProvider | null;
  providerCustomerId: string | null;
  providerProductId: string | null;
  providerSubscriptionId: string | null;
  providerTransactionId: string | null;
  hasActiveStripeSubscription: boolean;
  hasStripeSubscription: boolean;
  status: OrganizationBillingStatus;
}> {
  return withOrganizationAdminTransaction(
    db,
    { organizationId, userId: sessionUserId },
    async (tx) => {
      const [row] = await tx
        .select({
          provider: organizationBilling.provider,
          providerCustomerId: organizationBilling.providerCustomerId,
          providerProductId: organizationBilling.providerProductId,
          providerSubscriptionId: organizationBilling.providerSubscriptionId,
          providerTransactionId: organizationBilling.providerTransactionId,
          stripePriceId: organizationBillingStripeSeats.priceId,
          stripeSubscriptionId: organizationBillingStripeSeats.subscriptionId,
          stripeSubscriptionItemId:
            organizationBillingStripeSeats.subscriptionItemId,
          status: organizationBilling.status,
        })
        .from(organizationBilling)
        .leftJoin(
          organizationBillingStripeSeats,
          eq(
            organizationBillingStripeSeats.organizationId,
            organizationBilling.organizationId,
          ),
        )
        .where(eq(organizationBilling.organizationId, organizationId))
        .limit(1);
      if (!row) {
        throw new OrganizationManagerError(
          "Organization billing not found",
          404,
        );
      }
      return {
        provider: row.provider,
        providerCustomerId: row.providerCustomerId,
        providerProductId: row.providerProductId,
        providerSubscriptionId: row.providerSubscriptionId,
        providerTransactionId: row.providerTransactionId,
        hasActiveStripeSubscription: hasActiveStripeBinding({
          priceId: row.stripePriceId,
          subscriptionId: row.stripeSubscriptionId,
          subscriptionItemId: row.stripeSubscriptionItemId,
        }),
        hasStripeSubscription: hasStripeBindingIdentity({
          subscriptionId: row.stripeSubscriptionId,
          subscriptionItemId: row.stripeSubscriptionItemId,
        }),
        status: row.status,
      };
    },
  );
}

export async function runStartOrganizationTrialWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  now: Date = new Date(),
): Promise<{
  readonly activeMemberCount: number;
  readonly assignedSeatCount: number;
  readonly assignedUserIds: readonly string[];
  readonly billing: OrganizationBilling;
  readonly currentUserHasSyncSeat: boolean;
}> {
  return db.transaction(async (tx) => {
    const billing = await startOrganizationTrialInTransaction({
      executor: tx,
      now,
      organizationId,
      sessionUserId,
    });
    const activeMemberCount = await countActiveOrganizationMembers(
      tx,
      organizationId,
    );
    const seatUsage = await loadOrganizationBillingSeatUsage({
      executor: tx,
      organizationId,
      sessionUserId,
    });
    return { activeMemberCount, billing, ...seatUsage };
  });
}
