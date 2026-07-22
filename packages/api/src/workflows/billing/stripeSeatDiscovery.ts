import { randomUUID } from "node:crypto";
import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  organizations,
} from "@tearleads/api-shared/schema";
import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { normalizeStripeSeatQuantity } from "../../billing/stripeSeatQuantity";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";

const LEASE_MS = 5 * 60 * 1000;
const MAX_RETRY_MS = 60 * 60 * 1000;

export interface StripeSeatDiscoveryClaim {
  readonly leaseId: string;
  readonly organizationId: string;
}

function availableDiscoveryLease(now: Date) {
  return or(
    isNull(organizationBillingStripeSeats.leaseExpiresAt),
    lte(organizationBillingStripeSeats.leaseExpiresAt, now),
  );
}

function isLegacyStripeWebBilling() {
  return and(
    eq(organizationBilling.status, "active"),
    eq(organizationBilling.provider, "revenuecat"),
    sql<boolean>`substr(${organizationBilling.providerSubscriptionId}, 1, 3) = 'si_'`,
  );
}

function nextRetryAt(now: Date, attemptCount: number): Date {
  const delayMs = Math.min(MAX_RETRY_MS, 2 ** attemptCount * 1000);
  return new Date(now.getTime() + delayMs);
}

/** Seeds legacy RevenueCat-web subscriptions into the durable seat outbox. */
export async function seedLegacyOrganizationStripeSeats(
  db: ApiDatabase,
  now: Date = new Date(),
): Promise<number> {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        memberGroupId: organizations.memberGroupId,
        organizationId: organizationBilling.organizationId,
        seatCount: organizationBilling.seatCount,
        seatPeriodKey: organizationBilling.seatPeriodKey,
      })
      .from(organizationBilling)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationBilling.organizationId),
      )
      .leftJoin(
        organizationBillingStripeSeats,
        eq(
          organizationBillingStripeSeats.organizationId,
          organizationBilling.organizationId,
        ),
      )
      .where(
        and(
          isLegacyStripeWebBilling(),
          isNull(organizationBillingStripeSeats.id),
        ),
      );

    let seeded = 0;
    for (const candidate of candidates) {
      const activeUserIds = await listUsersReachableFromCurrentGroup({
        executor: tx,
        groupId: candidate.memberGroupId,
      });
      const paidCapacity = normalizeStripeSeatQuantity(candidate.seatCount);
      const renewalQuantity = normalizeStripeSeatQuantity(activeUserIds.length);
      const inserted = await tx
        .insert(organizationBillingStripeSeats)
        .values({
          desiredPaidCapacity: paidCapacity,
          desiredRenewalQuantity: renewalQuantity,
          desiredRevision: 1,
          desiredSeatPeriodKey: candidate.seatPeriodKey,
          nextAttemptAt: now,
          organizationId: candidate.organizationId,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: organizationBillingStripeSeats.id });
      seeded += inserted.length;
    }
    return seeded;
  });
}

/** Claims one due, unbound legacy web subscription for Stripe discovery. */
export async function claimOrganizationStripeSeatDiscovery(
  db: ApiDatabase,
  now: Date = new Date(),
): Promise<StripeSeatDiscoveryClaim | null> {
  return db.transaction(async (tx) => {
    const availableLease = availableDiscoveryLease(now);
    const [candidate] = await tx
      .select({ organizationId: organizationBillingStripeSeats.organizationId })
      .from(organizationBillingStripeSeats)
      .innerJoin(
        organizationBilling,
        eq(
          organizationBilling.organizationId,
          organizationBillingStripeSeats.organizationId,
        ),
      )
      .where(
        and(
          isLegacyStripeWebBilling(),
          isNull(organizationBillingStripeSeats.subscriptionId),
          lte(organizationBillingStripeSeats.nextAttemptAt, now),
          availableLease,
        ),
      )
      .orderBy(asc(organizationBillingStripeSeats.nextAttemptAt))
      .limit(1);
    if (!candidate) {
      return null;
    }

    const leaseId = randomUUID();
    const [leased] = await tx
      .update(organizationBillingStripeSeats)
      .set({
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        leaseId,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            organizationBillingStripeSeats.organizationId,
            candidate.organizationId,
          ),
          isNull(organizationBillingStripeSeats.subscriptionId),
          availableLease,
        ),
      )
      .returning({
        organizationId: organizationBillingStripeSeats.organizationId,
      });
    return leased ? { leaseId, organizationId: leased.organizationId } : null;
  });
}

/** Releases a successfully bound row so normal seat synchronization can claim it. */
export async function completeOrganizationStripeSeatDiscovery(input: {
  readonly claim: StripeSeatDiscoveryClaim;
  readonly executor: DatabaseSession;
  readonly now: Date;
}): Promise<void> {
  await input.executor
    .update(organizationBillingStripeSeats)
    .set({
      attemptCount: 0,
      lastError: null,
      leaseExpiresAt: null,
      leaseId: null,
      nextAttemptAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(
          organizationBillingStripeSeats.organizationId,
          input.claim.organizationId,
        ),
        or(
          eq(organizationBillingStripeSeats.leaseId, input.claim.leaseId),
          and(
            isNull(organizationBillingStripeSeats.leaseId),
            isNotNull(organizationBillingStripeSeats.subscriptionId),
          ),
        ),
      ),
    );
}

/** Releases a failed discovery with durable exponential retry state. */
export async function failOrganizationStripeSeatDiscovery(input: {
  readonly claim: StripeSeatDiscoveryClaim;
  readonly error: string;
  readonly executor: DatabaseSession;
  readonly now: Date;
}): Promise<void> {
  const [current] = await input.executor
    .select({
      attemptCount: organizationBillingStripeSeats.attemptCount,
      id: organizationBillingStripeSeats.id,
    })
    .from(organizationBillingStripeSeats)
    .where(
      and(
        eq(
          organizationBillingStripeSeats.organizationId,
          input.claim.organizationId,
        ),
        eq(organizationBillingStripeSeats.leaseId, input.claim.leaseId),
      ),
    )
    .limit(1);
  if (!current) {
    return;
  }
  const attemptCount = current.attemptCount + 1;
  await input.executor
    .update(organizationBillingStripeSeats)
    .set({
      attemptCount,
      lastError: input.error.slice(0, 1000),
      leaseExpiresAt: null,
      leaseId: null,
      nextAttemptAt: nextRetryAt(input.now, attemptCount),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(organizationBillingStripeSeats.id, current.id),
        eq(organizationBillingStripeSeats.leaseId, input.claim.leaseId),
      ),
    );
}
