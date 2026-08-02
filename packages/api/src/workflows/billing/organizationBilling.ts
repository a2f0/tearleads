import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingProvider,
  type OrganizationBillingStatus,
  organizationBilling,
  organizationBillingStripeSeats,
  organizations,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import { and, desc, eq, gt, gte, inArray } from "drizzle-orm";
import {
  createTrialBillingFields,
  LAPSED_BILLING_PURGE_GRACE_MS,
  type OrganizationBilling,
  organizationCanSync,
  organizationSeatPeriodKey,
} from "../../billing/organizationBilling";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";
import {
  hasActiveStripeBinding,
  hasStripeBindingIdentity,
} from "./stripeBindingPolicy";

const BILLING_ROW_COLUMNS = {
  organizationId: organizationBilling.organizationId,
  status: organizationBilling.status,
  trialEndsAt: organizationBilling.trialEndsAt,
  provider: organizationBilling.provider,
  providerCustomerId: organizationBilling.providerCustomerId,
  currentPeriodStartsAt: organizationBilling.currentPeriodStartsAt,
  currentPeriodEndsAt: organizationBilling.currentPeriodEndsAt,
  seatCount: organizationBilling.seatCount,
  providerProductId: organizationBilling.providerProductId,
  disabledAt: organizationBilling.disabledAt,
  purgeAfter: organizationBilling.purgeAfter,
};

type OrganizationBillingRow = OrganizationBilling & {
  readonly providerCustomerId: string | null;
  readonly providerProductId: string | null;
};

async function loadOrganizationBilling(
  executor: DatabaseSession,
  organizationId: string,
): Promise<OrganizationBillingRow> {
  const [row] = await executor
    .select(BILLING_ROW_COLUMNS)
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId))
    .limit(1);

  if (!row) {
    throw new OrganizationManagerError("Organization billing not found", 404);
  }

  return row;
}

/**
 * Loads an organization's billing and returns an in-memory `disabled` view of a
 * lapsed billing period. When a `trialing` organization's `trialEndsAt` or an
 * `active` organization's `currentPeriodEndsAt` has passed, the returned
 * billing reports `disabled` (with a computed `disabledAt` and `purgeAfter`
 * grace deadline) WITHOUT persisting the transition.
 *
 * This is deliberately a pure read. It runs inside read transactions — the
 * shared container-access projection (`resolveContainerAccessProjection`) and
 * the GET billing endpoint — so it must not write: a write here would be a
 * write-on-read and, on a PostgreSQL read replica, a failed `UPDATE` poisons the
 * surrounding transaction (a JS `try/catch` cannot recover an aborted pg tx).
 * The sync gate stays correct regardless because {@link organizationCanSync}
 * also evaluates trial expiry in-memory; persisting the `disabled`/`purgeAfter`
 * transition (and the eventual purge) is the job of the background billing
 * sweep tracked separately.
 */
async function resolveOrganizationBilling(
  executor: DatabaseSession,
  organizationId: string,
  now: Date = new Date(),
): Promise<OrganizationBillingRow> {
  const billing = await loadOrganizationBilling(executor, organizationId);
  const disabledAt =
    billing.status === "trialing" &&
    billing.trialEndsAt !== null &&
    billing.trialEndsAt <= now
      ? billing.trialEndsAt
      : billing.status === "active" &&
          billing.currentPeriodEndsAt !== null &&
          billing.currentPeriodEndsAt <= now
        ? billing.currentPeriodEndsAt
        : null;
  if (disabledAt === null) {
    return billing;
  }

  const purgeAfter = new Date(
    disabledAt.getTime() + LAPSED_BILLING_PURGE_GRACE_MS,
  );
  return { ...billing, status: "disabled", disabledAt, purgeAfter };
}

/**
 * Resolves billing and reports whether the organization may currently sync.
 * Sync choke points use this to gate one organization's server sync.
 */
async function resolveOrganizationSyncEligibility(
  executor: DatabaseSession,
  organizationId: string,
  now: Date = new Date(),
): Promise<{ billing: OrganizationBilling; canSync: boolean }> {
  const billing = await resolveOrganizationBilling(
    executor,
    organizationId,
    now,
  );
  return { billing, canSync: organizationCanSync(billing, now) };
}

/**
 * Thrown when a sync operation targets an organization that cannot sync (its
 * billing is `local`/lapsed). Maps to HTTP 402 so the client can route to an
 * upgrade/enable-sync flow. Caught centrally by the route app error handler.
 */
export class OrganizationSyncDisabledError extends Error {
  readonly status = 402 as const;

  constructor(readonly organizationId: string) {
    super("Organization sync is not active");
    this.name = "OrganizationSyncDisabledError";
  }
}

/**
 * Guards a sync write against the target organization's billing. Call at the
 * public sync workflow boundary once the authoritative `organizationId` is
 * known (registration's own bootstrap calls the lower-level handlers directly,
 * so it is intentionally not gated here). Throws {@link
 * OrganizationSyncDisabledError} (402) when the organization cannot sync.
 */
export async function assertOrganizationCanSync(
  executor: DatabaseSession,
  organizationId: string,
  now: Date = new Date(),
): Promise<void> {
  const { canSync } = await resolveOrganizationSyncEligibility(
    executor,
    organizationId,
    now,
  );
  if (!canSync) {
    throw new OrganizationSyncDisabledError(organizationId);
  }
}

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
    .set({ status, trialEndsAt, seatPeriodKey, updatedAt: input.now })
    .where(
      and(
        eq(organizationBilling.organizationId, input.organizationId),
        eq(organizationBilling.status, "local"),
      ),
    )
    .returning(BILLING_ROW_COLUMNS);

  if (!updated) {
    return loadOrganizationBilling(input.executor, input.organizationId);
  }

  await reconcileOrganizationBillingSeats({
    executor: input.executor,
    now: input.now,
    organizationId: input.organizationId,
    source: {
      sourceId: `trial:${input.organizationId}:${trialEndsAt.toISOString()}`,
      sourceType: "billing_transition",
    },
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
  readonly billing: OrganizationBilling;
  readonly pendingSeatCount: number | null;
}> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });
    const billing = await resolveOrganizationBilling(tx, organizationId, now);
    const activeMemberCount = await countActiveOrganizationMembers(
      tx,
      organizationId,
    );
    const pendingSeatCount = await resolvePendingNativeSeatCount(
      tx,
      organizationId,
      billing,
    );
    return { activeMemberCount, billing, pendingSeatCount };
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
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      requireAdmin: true,
      userId: sessionUserId,
    });
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
      throw new OrganizationManagerError("Organization billing not found", 404);
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
  });
}

export async function runStartOrganizationTrialWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  now: Date = new Date(),
): Promise<{
  readonly activeMemberCount: number;
  readonly billing: OrganizationBilling;
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
    return { activeMemberCount, billing };
  });
}
