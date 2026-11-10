import { randomUUID } from "node:crypto";
import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingStatus,
  organizationBilling,
  organizations,
} from "@tearleads/api-shared/schema";
import {
  BILLING_ERROR_CODES,
  getSyncBillingTierForSeatCount,
  type SyncBillingTierId,
} from "@tearleads/validators/billing";
import { eq } from "drizzle-orm";
import { lockRowForUpdate } from "../../utils/sqlDialect";
import { OrganizationManagerError } from "../organizations/errors";
import { withOrganizationAdminTransaction } from "../organizations/mutationAccess";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";

type StripeCheckoutMode = "hosted" | "inline";

export interface StripeCheckoutAttempt {
  readonly attemptId: string;
  readonly expiresAt: Date;
  readonly providerExpiresAt: Date | null;
  readonly seatQuantity: number;
}

/** What reserving the organization's one unpaid checkout attempt found. */
export type StripeCheckoutAttemptAcquisition =
  | { readonly kind: "acquired"; readonly attempt: StripeCheckoutAttempt }
  /**
   * The same buyer's unexpired attempt in this mode reserved a seat count the
   * roster no longer has. It stays reserved until the caller retires its
   * provider checkout and replaces it.
   */
  | { readonly kind: "stale"; readonly staleAttemptId: string };

/** An unexpired attempt as it relates to a new request. */
type ActiveStripeCheckoutAttempt =
  | { readonly kind: "none" }
  | { readonly kind: "matching"; readonly attempt: StripeCheckoutAttempt }
  | { readonly kind: "stale"; readonly attemptId: string };

const NO_ACTIVE_ATTEMPT: ActiveStripeCheckoutAttempt = { kind: "none" };

interface StripeCheckoutBillingState {
  readonly attemptExpiresAt: Date | null;
  readonly attemptId: string | null;
  readonly attemptMode: StripeCheckoutMode | null;
  readonly attemptSeatQuantity: number | null;
  readonly attemptUserId: string | null;
  readonly status: OrganizationBillingStatus;
}

const INLINE_ATTEMPT_MS = 24 * 60 * 60 * 1_000;
const HOSTED_ATTEMPT_MS = 50 * 60 * 1_000;
const HOSTED_EXPIRY_SAFETY_MS = 5 * 60 * 1_000;
const HOSTED_MIN_PROVIDER_REMAINING_MS = 30 * 60 * 1_000;

export function stripeCheckoutInProgress(): OrganizationManagerError {
  return new OrganizationManagerError(
    "A checkout is already in progress for this organization",
    409,
  );
}

function requireAvailableTier(seatCount: number) {
  const tier = getSyncBillingTierForSeatCount(seatCount);
  if (!tier) {
    throw new OrganizationManagerError(
      "The organization exceeds the maximum subscription tier of 10 members",
      409,
      BILLING_ERROR_CODES.rosterOverCapacity,
    );
  }
  return tier;
}

function providerExpiresAt(
  mode: StripeCheckoutMode,
  expiresAt: Date,
): Date | null {
  return mode === "hosted"
    ? new Date(expiresAt.getTime() - HOSTED_EXPIRY_SAFETY_MS)
    : null;
}

async function lockStripeCheckoutBilling(
  executor: DatabaseSession,
  organizationId: string,
): Promise<StripeCheckoutBillingState> {
  const query = executor
    .select({
      attemptExpiresAt: organizationBilling.checkoutAttemptExpiresAt,
      attemptId: organizationBilling.checkoutAttemptId,
      attemptMode: organizationBilling.checkoutAttemptMode,
      attemptSeatQuantity: organizationBilling.checkoutAttemptSeatQuantity,
      attemptUserId: organizationBilling.checkoutAttemptUserId,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId))
    .limit(1);
  const [billing] = await lockRowForUpdate(query);
  if (!billing) {
    throw new Error("Organization billing not found during Stripe checkout");
  }
  if (billing.status === "active") {
    throw new OrganizationManagerError(
      "The organization already has an active subscription",
      409,
    );
  }
  if (billing.status === "deleting" || billing.status === "purged") {
    throw new OrganizationManagerError(
      "Organization purge is terminal; provision a replacement organization",
      409,
    );
  }
  return billing;
}

async function requireStripeCheckoutSeatQuantity(
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
  const activeUserIds = await listUsersReachableFromCurrentGroup({
    executor,
    groupId: organization.memberGroupId,
  });
  if (activeUserIds.length === 0) {
    throw new OrganizationManagerError(
      "The organization has no active members",
      409,
      BILLING_ERROR_CODES.checkoutNoActiveMembers,
    );
  }
  requireAvailableTier(activeUserIds.length);
  return activeUserIds.length;
}

function resolveActiveStripeCheckoutAttempt(input: {
  readonly billing: StripeCheckoutBillingState;
  readonly mode: StripeCheckoutMode;
  readonly now: Date;
  readonly seatQuantity: number;
  readonly sessionUserId: string;
}): ActiveStripeCheckoutAttempt {
  const { attemptExpiresAt, attemptId } = input.billing;
  if (!attemptExpiresAt || attemptExpiresAt <= input.now) {
    if (attemptId !== null && attemptExpiresAt === null) {
      throw stripeCheckoutInProgress();
    }
    return NO_ACTIVE_ATTEMPT;
  }
  if (
    attemptId === null ||
    input.billing.attemptMode !== input.mode ||
    input.billing.attemptUserId !== input.sessionUserId
  ) {
    throw stripeCheckoutInProgress();
  }
  if (input.billing.attemptSeatQuantity !== input.seatQuantity) {
    return { kind: "stale", attemptId };
  }
  const providerExpiry = providerExpiresAt(input.mode, attemptExpiresAt);
  if (
    providerExpiry !== null &&
    providerExpiry.getTime() <=
      input.now.getTime() + HOSTED_MIN_PROVIDER_REMAINING_MS
  ) {
    throw stripeCheckoutInProgress();
  }
  return {
    kind: "matching",
    attempt: {
      attemptId,
      expiresAt: attemptExpiresAt,
      providerExpiresAt: providerExpiry,
      seatQuantity: input.seatQuantity,
    },
  };
}

async function createStripeCheckoutAttempt(input: {
  readonly createAttemptId: () => string;
  readonly executor: DatabaseSession;
  readonly mode: StripeCheckoutMode;
  readonly now: Date;
  readonly organizationId: string;
  readonly seatQuantity: number;
  readonly sessionUserId: string;
}): Promise<StripeCheckoutAttempt> {
  const attemptId = input.createAttemptId().trim();
  if (!attemptId) {
    throw new Error("Stripe checkout attempt id must not be empty");
  }
  const lifetimeMs =
    input.mode === "hosted" ? HOSTED_ATTEMPT_MS : INLINE_ATTEMPT_MS;
  const expiresAt = new Date(input.now.getTime() + lifetimeMs);
  await input.executor
    .update(organizationBilling)
    .set({
      checkoutAttemptExpiresAt: expiresAt,
      checkoutAttemptId: attemptId,
      checkoutAttemptMode: input.mode,
      checkoutAttemptSeatQuantity: input.seatQuantity,
      checkoutAttemptStartedAt: input.now,
      checkoutAttemptUserId: input.sessionUserId,
      updatedAt: input.now,
    })
    .where(eq(organizationBilling.organizationId, input.organizationId));
  return {
    attemptId,
    expiresAt,
    providerExpiresAt: providerExpiresAt(input.mode, expiresAt),
    seatQuantity: input.seatQuantity,
  };
}

/**
 * The org-admin gate for the cancel and Billing Portal operations (issue
 * #1654). It also returns the billing row's stored `providerSubscriptionId`,
 * but cancel/portal deliberately ignore it: that column is the
 * RevenueCat-reported Stripe *item* id (`si_…`), not the `sub_…` those APIs
 * need, so they resolve the subscription from Stripe instead (see
 * `findLiveOrgSubscription`). The value is retained for any caller that wants
 * the stored id, and this workflow's real job is the admin check —
 * `requireDirectOrganizationAccess` throws for a non-admin, which is what keeps
 * a co-admin or multi-org purchaser from managing another org's billing.
 */
export async function runResolveOrgSubscriptionForAdminWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<{ providerSubscriptionId: string | null }> {
  return withOrganizationAdminTransaction(
    db,
    { organizationId, userId: sessionUserId },
    async (tx) => {
      const [row] = await tx
        .select({
          providerSubscriptionId: organizationBilling.providerSubscriptionId,
        })
        .from(organizationBilling)
        .where(eq(organizationBilling.organizationId, organizationId))
        .limit(1);
      return { providerSubscriptionId: row?.providerSubscriptionId ?? null };
    },
  );
}

/**
 * The admin gate plus a duplicate-purchase guard and authoritative initial seat
 * count. An org whose billing row is already `active` must not start another
 * checkout — each confirmed checkout creates a NEW Stripe subscription, so
 * allowing it would double-bill the org. The raw stored status is deliberate:
 * only a provider revoke event clears `active`, and until then a second
 * subscription can only duplicate the one the provider still reports.
 */
export async function runRequireCheckoutEligibleWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<{ seatQuantity: number; tierId: SyncBillingTierId }> {
  return withOrganizationAdminTransaction(
    db,
    { organizationId, userId: sessionUserId },
    async (tx) => {
      const [row] = await tx
        .select({
          memberGroupId: organizations.memberGroupId,
          status: organizationBilling.status,
        })
        .from(organizations)
        .leftJoin(
          organizationBilling,
          eq(organizationBilling.organizationId, organizations.id),
        )
        .where(eq(organizations.id, organizationId))
        .limit(1);
      if (!row) {
        throw new OrganizationManagerError("Organization not found", 404);
      }
      if (row.status === "active") {
        throw new OrganizationManagerError(
          "The organization already has an active subscription",
          409,
        );
      }

      // Access validation above already establishes that the organization exists.
      // Count the signed Members-group projection in this same transaction so the
      // quantity sent to Stripe is server-authoritative and belongs to the exact
      // roster state that passed the checkout gate. The stored licensed seat count
      // is intentionally not used: before a first subscription it can still be 0.
      const activeUserIds = await listUsersReachableFromCurrentGroup({
        executor: tx,
        groupId: row.memberGroupId,
      });
      if (activeUserIds.length === 0) {
        throw new OrganizationManagerError(
          "The organization has no active members",
          409,
          BILLING_ERROR_CODES.checkoutNoActiveMembers,
        );
      }

      const tier = requireAvailableTier(activeUserIds.length);
      return { seatQuantity: activeUserIds.length, tierId: tier.id };
    },
  );
}

interface AcquireStripeCheckoutAttemptInput {
  readonly createAttemptId: () => string;
  readonly mode: StripeCheckoutMode;
  readonly now: Date;
  readonly organizationId: string;
  /** The stale attempt the caller retired, which may now rotate. */
  readonly replacing: string | null;
  readonly sessionUserId: string;
}

function acquireStripeCheckoutAttempt(
  db: ApiDatabase,
  input: AcquireStripeCheckoutAttemptInput,
): Promise<StripeCheckoutAttemptAcquisition> {
  const { organizationId, sessionUserId } = input;
  return withOrganizationAdminTransaction(
    db,
    { organizationId, userId: sessionUserId },
    async (tx) => {
      const billing = await lockStripeCheckoutBilling(tx, organizationId);
      const seatQuantity = await requireStripeCheckoutSeatQuantity(
        tx,
        organizationId,
      );
      const active = resolveActiveStripeCheckoutAttempt({
        billing,
        mode: input.mode,
        now: input.now,
        seatQuantity,
        sessionUserId,
      });
      if (active.kind === "matching") {
        return { kind: "acquired", attempt: active.attempt };
      }
      if (active.kind === "stale" && active.attemptId !== input.replacing) {
        return { kind: "stale", staleAttemptId: active.attemptId };
      }
      const attempt = await createStripeCheckoutAttempt({
        createAttemptId: input.createAttemptId,
        executor: tx,
        mode: input.mode,
        now: input.now,
        organizationId,
        seatQuantity,
        sessionUserId,
      });
      return { kind: "acquired", attempt };
    },
  );
}

/**
 * Atomically reserves the organization's one unpaid Stripe checkout. Both UI
 * modes call this before touching Stripe, so an inline subscription create and
 * a hosted Session create cannot pass independent provider searches and race.
 * A byte-for-byte retry by the same buyer reuses the durable token and seat
 * snapshot. Another buyer or the other UI mode conflicts until expiry; the
 * same buyer's attempt for a roster that has since changed comes back
 * `stale`.
 *
 * PostgreSQL serializes contenders with a billing-row lock. The SQLite adapter
 * runs transactions through one `BEGIN IMMEDIATE` queue, so it provides the
 * same single-winner behavior without unsupported `FOR UPDATE` syntax.
 */
export async function runAcquireStripeCheckoutAttemptWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  mode: StripeCheckoutMode,
  now: Date = new Date(),
  createAttemptId: () => string = randomUUID,
): Promise<StripeCheckoutAttemptAcquisition> {
  return acquireStripeCheckoutAttempt(db, {
    createAttemptId,
    mode,
    now,
    organizationId,
    replacing: null,
    sessionUserId,
  });
}

/**
 * Rotates the stale inline attempt `staleAttemptId` to the current seat count
 * once the caller has voided its unpaid Stripe checkout. A concurrent request
 * that already replaced it is reused; an attempt that went stale since is
 * reported `stale` again rather than replaced unretired.
 */
export async function runReplaceStaleInlineCheckoutAttemptWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  staleAttemptId: string,
  now: Date = new Date(),
  createAttemptId: () => string = randomUUID,
): Promise<StripeCheckoutAttemptAcquisition> {
  return acquireStripeCheckoutAttempt(db, {
    createAttemptId,
    mode: "inline",
    now,
    organizationId,
    replacing: staleAttemptId,
    sessionUserId,
  });
}
