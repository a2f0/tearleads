import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingSeatEventSourceType,
  type OrganizationBillingSeatEventType,
  type OrganizationBillingStatus,
  organizationBilling,
  organizationBillingSeatAssignments,
  organizationBillingSeatEvents,
  organizationBillingStripeSeats,
  organizations,
} from "@tearleads/api-shared/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  organizationCanSync,
  organizationSeatPeriodKey,
} from "../../billing/organizationBilling";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";
import { requiredLicensedSeatCount } from "./organizationSeatCapacity";
import { reconcileOrganizationStripeSeatState } from "./organizationStripeSeatReconciliation";
import { hasActiveStripeBinding } from "./stripeBindingPolicy";

type SeatAssignmentInsert =
  typeof organizationBillingSeatAssignments.$inferInsert;
type SeatEventInsert = typeof organizationBillingSeatEvents.$inferInsert;

interface BillingSeatSource {
  readonly sourceType: OrganizationBillingSeatEventSourceType;
  readonly sourceId: string;
  readonly sourcePrincipalId?: string | null;
  readonly sourcePrincipalType?: "group" | "organization" | null;
}

interface BillingSeatState {
  readonly hasStripeSubscription: boolean;
  readonly organizationId: string;
  readonly memberGroupId: string;
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodStartsAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
  readonly providerProductId: string | null;
  readonly seatCount: number;
  readonly seatPeriodKey: string | null;
}

interface OpenSeatAssignment {
  readonly assignedAt: Date;
  readonly id: string;
  readonly userId: string;
}

interface OrganizationBillingSeatUsage {
  readonly assignedSeatCount: number;
  readonly assignedUserIds: readonly string[];
  readonly currentUserHasSyncSeat: boolean;
}

function buildSeatEvent(input: {
  readonly activeSeatCount: number;
  readonly billing: BillingSeatState;
  readonly eventType: OrganizationBillingSeatEventType;
  readonly licensedSeatCount: number;
  readonly quantityDelta: number;
  readonly source: BillingSeatSource;
  readonly userId?: string | null;
}): SeatEventInsert {
  return {
    activeSeatCount: input.activeSeatCount,
    billingPeriodEndsAt: input.billing.currentPeriodEndsAt,
    billingPeriodStartsAt: input.billing.currentPeriodStartsAt,
    eventType: input.eventType,
    licensedSeatCount: input.licensedSeatCount,
    organizationId: input.billing.organizationId,
    quantityDelta: input.quantityDelta,
    sourceId: input.source.sourceId,
    sourcePrincipalId: input.source.sourcePrincipalId ?? null,
    sourcePrincipalType: input.source.sourcePrincipalType ?? null,
    sourceType: input.source.sourceType,
    userId: input.userId ?? null,
  };
}

async function loadBillingSeatState(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<BillingSeatState | null> {
  const query = input.executor
    .select({
      stripeSubscriptionId: organizationBillingStripeSeats.subscriptionId,
      stripeSubscriptionItemId:
        organizationBillingStripeSeats.subscriptionItemId,
      stripePriceId: organizationBillingStripeSeats.priceId,
      organizationId: organizationBilling.organizationId,
      memberGroupId: organizations.memberGroupId,
      status: organizationBilling.status,
      trialEndsAt: organizationBilling.trialEndsAt,
      currentPeriodStartsAt: organizationBilling.currentPeriodStartsAt,
      currentPeriodEndsAt: organizationBilling.currentPeriodEndsAt,
      providerProductId: organizationBilling.providerProductId,
      seatCount: organizationBilling.seatCount,
      seatPeriodKey: organizationBilling.seatPeriodKey,
    })
    .from(organizationBilling)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationBilling.organizationId),
    )
    .leftJoin(
      // The schema's unique organization-id index makes this a zero-or-one
      // join, so locking only the billing row cannot duplicate seat state.
      organizationBillingStripeSeats,
      eq(
        organizationBillingStripeSeats.organizationId,
        organizationBilling.organizationId,
      ),
    )
    .where(eq(organizationBilling.organizationId, input.organizationId))
    .limit(1);

  const [row] = isSqliteApiDatabase()
    ? await query
    : await query.for("update", { of: organizationBilling });
  return row
    ? {
        ...row,
        hasStripeSubscription: hasActiveStripeBinding({
          priceId: row.stripePriceId,
          subscriptionId: row.stripeSubscriptionId,
          subscriptionItemId: row.stripeSubscriptionItemId,
        }),
      }
    : null;
}

async function listOpenSeatAssignments(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<OpenSeatAssignment[]> {
  return input.executor
    .select({
      assignedAt: organizationBillingSeatAssignments.assignedAt,
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
    )
    .orderBy(
      asc(organizationBillingSeatAssignments.assignedAt),
      asc(organizationBillingSeatAssignments.userId),
    );
}

export async function loadOrganizationBillingSeatUsage(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly sessionUserId: string;
}): Promise<OrganizationBillingSeatUsage> {
  const assignedUserIds = (
    await listOpenSeatAssignments({
      executor: input.executor,
      organizationId: input.organizationId,
    })
  ).map((assignment) => assignment.userId);
  return {
    assignedSeatCount: assignedUserIds.length,
    assignedUserIds,
    currentUserHasSyncSeat: assignedUserIds.includes(input.sessionUserId),
  };
}

async function insertSeatEvents(
  executor: DatabaseSession,
  events: SeatEventInsert[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  await executor.insert(organizationBillingSeatEvents).values(events);
}

async function releaseAssignments(input: {
  readonly activeSeatCount: number;
  readonly assignments: readonly OpenSeatAssignment[];
  readonly billing: BillingSeatState;
  readonly events: SeatEventInsert[];
  readonly executor: DatabaseSession;
  readonly licensedSeatCount: number;
  readonly now: Date;
  readonly source: BillingSeatSource;
}): Promise<void> {
  if (input.assignments.length === 0) {
    return;
  }

  await input.executor
    .update(organizationBillingSeatAssignments)
    .set({
      releasedAt: input.now,
      releaseSourceId: input.source.sourceId,
      releaseSourceType: input.source.sourceType,
      updatedAt: input.now,
    })
    .where(
      inArray(
        organizationBillingSeatAssignments.id,
        input.assignments.map((assignment) => assignment.id),
      ),
    );

  for (const assignment of input.assignments) {
    input.events.push(
      buildSeatEvent({
        activeSeatCount: input.activeSeatCount,
        billing: input.billing,
        eventType: "seat_released",
        licensedSeatCount: input.licensedSeatCount,
        quantityDelta: 0,
        source: input.source,
        userId: assignment.userId,
      }),
    );
  }
}

async function assignSeats(input: {
  readonly activeSeatCount: number;
  readonly billing: BillingSeatState;
  readonly events: SeatEventInsert[];
  readonly executor: DatabaseSession;
  readonly licensedSeatCount: number;
  readonly now: Date;
  readonly source: BillingSeatSource;
  readonly userIds: readonly string[];
}): Promise<void> {
  if (input.userIds.length === 0) {
    return;
  }

  const assignments: SeatAssignmentInsert[] = input.userIds.map((userId) => ({
    assignedAt: input.now,
    assignmentSourceId: input.source.sourceId,
    assignmentSourceType: input.source.sourceType,
    billingPeriodEndsAt: input.billing.currentPeriodEndsAt,
    billingPeriodStartsAt: input.billing.currentPeriodStartsAt,
    organizationId: input.billing.organizationId,
    userId,
  }));
  await input.executor
    .insert(organizationBillingSeatAssignments)
    .values(assignments);

  for (const userId of input.userIds) {
    input.events.push(
      buildSeatEvent({
        activeSeatCount: input.activeSeatCount,
        billing: input.billing,
        eventType: "seat_assigned",
        licensedSeatCount: input.licensedSeatCount,
        quantityDelta: 0,
        source: input.source,
        userId,
      }),
    );
  }
}

async function updateLicensedSeatCount(input: {
  readonly activeSeatCount: number;
  readonly billing: BillingSeatState;
  readonly eventType: OrganizationBillingSeatEventType;
  readonly events: SeatEventInsert[];
  readonly executor: DatabaseSession;
  readonly nextSeatCount: number;
  readonly now: Date;
  readonly source: BillingSeatSource;
}): Promise<void> {
  if (input.nextSeatCount === input.billing.seatCount) {
    return;
  }

  await input.executor
    .update(organizationBilling)
    .set({ seatCount: input.nextSeatCount, updatedAt: input.now })
    .where(
      eq(organizationBilling.organizationId, input.billing.organizationId),
    );

  input.events.push(
    buildSeatEvent({
      activeSeatCount: input.activeSeatCount,
      billing: input.billing,
      eventType: input.eventType,
      licensedSeatCount: input.nextSeatCount,
      quantityDelta: input.nextSeatCount - input.billing.seatCount,
      source: input.source,
    }),
  );
}

async function rotateOpenAssignmentsToBillingPeriod(input: {
  readonly activeUserIds: readonly string[];
  readonly billing: BillingSeatState;
  readonly events: SeatEventInsert[];
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly openAssignments: readonly OpenSeatAssignment[];
  readonly source: BillingSeatSource;
  readonly periodChanged: boolean;
}): Promise<{
  readonly currentAssignments: readonly OpenSeatAssignment[];
  readonly preferredUserIds: readonly string[];
}> {
  if (!input.periodChanged) {
    return {
      currentAssignments: input.openAssignments,
      preferredUserIds: [...input.activeUserIds].sort(),
    };
  }

  const activeUserIdSet = new Set(input.activeUserIds);
  const previouslyAssignedActiveUserIds = input.openAssignments
    .filter((assignment) => activeUserIdSet.has(assignment.userId))
    .map((assignment) => assignment.userId);
  const previouslyAssignedActiveUserIdSet = new Set(
    previouslyAssignedActiveUserIds,
  );

  await releaseAssignments({
    activeSeatCount: input.activeUserIds.length,
    assignments: input.openAssignments,
    billing: input.billing,
    events: input.events,
    executor: input.executor,
    licensedSeatCount: input.billing.seatCount,
    now: input.now,
    source: input.source,
  });

  return {
    currentAssignments: [],
    preferredUserIds: [
      ...previouslyAssignedActiveUserIds,
      ...input.activeUserIds
        .filter((userId) => !previouslyAssignedActiveUserIdSet.has(userId))
        .sort(),
    ],
  };
}

async function reconcileSeatAssignments(input: {
  readonly activeUserIds: readonly string[];
  readonly billing: BillingSeatState;
  readonly currentAssignments: readonly OpenSeatAssignment[];
  readonly events: SeatEventInsert[];
  readonly executor: DatabaseSession;
  readonly licensedSeatCount: number;
  readonly now: Date;
  readonly preferredUserIds: readonly string[];
  readonly source: BillingSeatSource;
}): Promise<void> {
  const activeUserIdSet = new Set(input.activeUserIds);
  const activeAssignments = input.currentAssignments.filter((assignment) =>
    activeUserIdSet.has(assignment.userId),
  );
  const retainedAssignments = activeAssignments.slice(
    0,
    input.licensedSeatCount,
  );
  const retainedUserIds = new Set(
    retainedAssignments.map((assignment) => assignment.userId),
  );
  await releaseAssignments({
    activeSeatCount: input.activeUserIds.length,
    assignments: input.currentAssignments.filter(
      (assignment) => !retainedUserIds.has(assignment.userId),
    ),
    billing: input.billing,
    events: input.events,
    executor: input.executor,
    licensedSeatCount: input.licensedSeatCount,
    now: input.now,
    source: input.source,
  });

  const availableSeatCount = Math.max(
    0,
    input.licensedSeatCount - retainedAssignments.length,
  );
  await assignSeats({
    activeSeatCount: input.activeUserIds.length,
    billing: input.billing,
    events: input.events,
    executor: input.executor,
    licensedSeatCount: input.licensedSeatCount,
    now: input.now,
    source: input.source,
    userIds: input.preferredUserIds
      .filter(
        (userId) => activeUserIdSet.has(userId) && !retainedUserIds.has(userId),
      )
      .slice(0, availableSeatCount),
  });
}

/** Reconciles stable assignments against roster membership and licensed capacity. */
export async function reconcileOrganizationBillingSeats(input: {
  readonly executor: DatabaseSession;
  readonly now?: Date;
  readonly organizationId: string;
  readonly source: BillingSeatSource;
}): Promise<void> {
  const now = input.now ?? new Date();
  const billing = await loadBillingSeatState({
    executor: input.executor,
    organizationId: input.organizationId,
  });
  if (!billing || !organizationCanSync(billing, now)) {
    return;
  }

  const activeUserIds = await listUsersReachableFromCurrentGroup({
    executor: input.executor,
    groupId: billing.memberGroupId,
  });
  const requiredSeatCount = requiredLicensedSeatCount(billing);
  const openAssignments = await listOpenSeatAssignments({
    executor: input.executor,
    organizationId: input.organizationId,
  });
  const nextSeatPeriodKey = organizationSeatPeriodKey(billing);
  const events: SeatEventInsert[] = [];
  if (requiredSeatCount !== billing.seatCount) {
    await updateLicensedSeatCount({
      activeSeatCount: activeUserIds.length,
      billing,
      eventType: "licensed_seat_count_initialized",
      events,
      executor: input.executor,
      nextSeatCount: requiredSeatCount,
      now,
      source: input.source,
    });
  }
  const { currentAssignments, preferredUserIds } =
    await rotateOpenAssignmentsToBillingPeriod({
      activeUserIds,
      billing,
      events,
      executor: input.executor,
      now,
      openAssignments,
      // A null key is a pre-column row being lazily initialized, not proof of a
      // renewal. Preserve its current-period paid high-water on first touch.
      periodChanged:
        billing.seatPeriodKey !== null &&
        billing.seatPeriodKey !== nextSeatPeriodKey,
      source: input.source,
    });

  await reconcileSeatAssignments({
    activeUserIds,
    billing,
    currentAssignments,
    events,
    executor: input.executor,
    licensedSeatCount: requiredSeatCount,
    now,
    preferredUserIds,
    source: input.source,
  });

  await input.executor
    .update(organizationBilling)
    .set({ seatPeriodKey: nextSeatPeriodKey, updatedAt: now })
    .where(eq(organizationBilling.organizationId, input.organizationId));
  await reconcileOrganizationStripeSeatState({
    executor: input.executor,
    hasStripeSubscription: billing.hasStripeSubscription,
    licensedSeatCount: requiredSeatCount,
    now,
    organizationId: input.organizationId,
    providerProductId: billing.providerProductId,
    seatPeriodKey: nextSeatPeriodKey,
  });

  await insertSeatEvents(input.executor, events);
}
