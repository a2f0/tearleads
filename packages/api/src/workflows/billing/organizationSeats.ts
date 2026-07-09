import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingSeatEventSourceType,
  type OrganizationBillingSeatEventType,
  type OrganizationBillingStatus,
  organizationBilling,
  organizationBillingSeatAssignments,
  organizationBillingSeatEvents,
  organizations,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { organizationCanSync } from "../../billing/organizationBilling";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";

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
  readonly organizationId: string;
  readonly memberGroupId: string;
  readonly status: OrganizationBillingStatus;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodStartsAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
  readonly seatCount: number;
}

interface OpenSeatAssignment {
  readonly id: string;
  readonly userId: string;
  readonly billingPeriodStartsAt: Date | null;
  readonly billingPeriodEndsAt: Date | null;
}

function sameTime(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function assignmentMatchesBillingPeriod(
  assignment: OpenSeatAssignment,
  billing: BillingSeatState,
): boolean {
  return (
    sameTime(assignment.billingPeriodStartsAt, billing.currentPeriodStartsAt) &&
    sameTime(assignment.billingPeriodEndsAt, billing.currentPeriodEndsAt)
  );
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
      organizationId: organizationBilling.organizationId,
      memberGroupId: organizations.memberGroupId,
      status: organizationBilling.status,
      trialEndsAt: organizationBilling.trialEndsAt,
      currentPeriodStartsAt: organizationBilling.currentPeriodStartsAt,
      currentPeriodEndsAt: organizationBilling.currentPeriodEndsAt,
      seatCount: organizationBilling.seatCount,
    })
    .from(organizationBilling)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationBilling.organizationId),
    )
    .where(eq(organizationBilling.organizationId, input.organizationId))
    .limit(1);

  const [row] = isSqliteApiDatabase()
    ? await query
    : await query.for("update", { of: organizationBilling });
  return row ?? null;
}

async function listOpenSeatAssignments(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<OpenSeatAssignment[]> {
  return input.executor
    .select({
      id: organizationBillingSeatAssignments.id,
      userId: organizationBillingSeatAssignments.userId,
      billingPeriodStartsAt:
        organizationBillingSeatAssignments.billingPeriodStartsAt,
      billingPeriodEndsAt:
        organizationBillingSeatAssignments.billingPeriodEndsAt,
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
}): Promise<{
  readonly currentAssignments: readonly OpenSeatAssignment[];
  readonly licensedSeatCount: number;
}> {
  const periodChanged = input.openAssignments.some(
    (assignment) => !assignmentMatchesBillingPeriod(assignment, input.billing),
  );
  if (!periodChanged) {
    return {
      currentAssignments: input.openAssignments,
      licensedSeatCount: input.billing.seatCount,
    };
  }

  await releaseAssignments({
    activeSeatCount: 0,
    assignments: input.openAssignments,
    billing: input.billing,
    events: input.events,
    executor: input.executor,
    licensedSeatCount: input.billing.seatCount,
    now: input.now,
    source: input.source,
  });

  const licensedSeatCount = input.activeUserIds.length;
  await updateLicensedSeatCount({
    activeSeatCount: input.activeUserIds.length,
    billing: input.billing,
    eventType: "licensed_seat_count_reset",
    events: input.events,
    executor: input.executor,
    nextSeatCount: licensedSeatCount,
    now: input.now,
    source: input.source,
  });

  return { currentAssignments: [], licensedSeatCount };
}

async function reconcileSeatAssignments(input: {
  readonly activeUserIds: readonly string[];
  readonly billing: BillingSeatState;
  readonly currentAssignments: readonly OpenSeatAssignment[];
  readonly events: SeatEventInsert[];
  readonly executor: DatabaseSession;
  readonly licensedSeatCount: number;
  readonly now: Date;
  readonly source: BillingSeatSource;
}): Promise<void> {
  const activeUserIdSet = new Set(input.activeUserIds);
  const currentUserIds = new Set(
    input.currentAssignments.map((assignment) => assignment.userId),
  );
  await releaseAssignments({
    activeSeatCount: input.activeUserIds.length,
    assignments: input.currentAssignments.filter(
      (assignment) => !activeUserIdSet.has(assignment.userId),
    ),
    billing: input.billing,
    events: input.events,
    executor: input.executor,
    licensedSeatCount: input.licensedSeatCount,
    now: input.now,
    source: input.source,
  });

  await assignSeats({
    activeSeatCount: input.activeUserIds.length,
    billing: input.billing,
    events: input.events,
    executor: input.executor,
    licensedSeatCount: input.licensedSeatCount,
    now: input.now,
    source: input.source,
    userIds: input.activeUserIds.filter(
      (userId) => !currentUserIds.has(userId),
    ),
  });
}

async function reconcileLicensedCapacity(input: {
  readonly activeUserIds: readonly string[];
  readonly billing: BillingSeatState;
  readonly events: SeatEventInsert[];
  readonly executor: DatabaseSession;
  readonly licensedSeatCount: number;
  readonly now: Date;
  readonly openAssignments: readonly OpenSeatAssignment[];
  readonly source: BillingSeatSource;
}): Promise<void> {
  const shouldInitialize =
    input.billing.seatCount === 0 &&
    input.openAssignments.length === 0 &&
    input.activeUserIds.length > 0;
  const eventType = shouldInitialize
    ? "licensed_seat_count_initialized"
    : "licensed_seat_count_increased";
  if (
    !shouldInitialize &&
    input.activeUserIds.length <= input.licensedSeatCount
  ) {
    return;
  }

  await updateLicensedSeatCount({
    activeSeatCount: input.activeUserIds.length,
    billing: input.billing,
    eventType,
    events: input.events,
    executor: input.executor,
    nextSeatCount: input.activeUserIds.length,
    now: input.now,
    source: input.source,
  });
}

/**
 * Reconciles organization seat accounting against the current effective Members
 * group. Seats can be transferred within the billing period: removing a member
 * releases their assignment, and adding a replacement consumes the released
 * capacity before increasing the licensed seat count.
 */
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
  const openAssignments = await listOpenSeatAssignments({
    executor: input.executor,
    organizationId: input.organizationId,
  });
  const events: SeatEventInsert[] = [];
  const { currentAssignments, licensedSeatCount } =
    await rotateOpenAssignmentsToBillingPeriod({
      activeUserIds,
      billing,
      events,
      executor: input.executor,
      now,
      openAssignments,
      source: input.source,
    });

  await reconcileSeatAssignments({
    activeUserIds,
    billing,
    currentAssignments,
    events,
    executor: input.executor,
    licensedSeatCount,
    now,
    source: input.source,
  });
  await reconcileLicensedCapacity({
    activeUserIds,
    billing,
    events,
    executor: input.executor,
    licensedSeatCount,
    now,
    openAssignments,
    source: input.source,
  });

  await insertSeatEvents(input.executor, events);
}
