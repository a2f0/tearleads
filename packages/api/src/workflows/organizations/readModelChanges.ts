import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationGroupTombstones,
  organizationReadModelHeads,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { isSqliteApiDatabase, lockRowForUpdate } from "../../utils/sqlDialect";

export interface ObservedOrganizationReadModelChange {
  readonly affectedUserIds: readonly string[];
  readonly cursor: bigint;
  readonly organizationId: string;
}

export interface CommittedOrganizationReadModelChange
  extends ObservedOrganizationReadModelChange {
  readonly recipientUserIds: readonly string[];
}

interface ObservedOrganizationState {
  readonly affectedUserIds: Set<string>;
  cursor: bigint | null;
}

const organizationReadModelChangeScope = new AsyncLocalStorage<
  Map<string, ObservedOrganizationState>
>();

function observedOrganizationState(
  store: Map<string, ObservedOrganizationState>,
  organizationId: string,
): ObservedOrganizationState {
  let state = store.get(organizationId);
  if (!state) {
    state = { affectedUserIds: new Set(), cursor: null };
    store.set(organizationId, state);
  }
  return state;
}

/**
 * Add users whose organization access this request's mutation transitioned to
 * the hint audience. The post-commit audience query returns active roster
 * rows only, so the one member a removal or disable affects would otherwise
 * never be woken to discover the denial. Recorded users are published only
 * when a read-model change for the organization is also observed and commits.
 */
export function recordOrganizationReadModelChangeAudience(
  organizationId: string,
  userIds: readonly string[],
): void {
  if (userIds.length === 0) {
    return;
  }
  const store = organizationReadModelChangeScope.getStore();
  if (!store) {
    return;
  }
  const state = observedOrganizationState(store, organizationId);
  for (const userId of userIds) {
    state.affectedUserIds.add(userId);
  }
}

/**
 * Collect the highest cursor observed for each organization while one HTTP
 * request runs. Observation happens before the surrounding transaction
 * commits; the route composition root verifies these cursors against the
 * committed cursor heads before publishing lossy hints.
 */
export async function collectOrganizationReadModelChanges<T>(
  operation: () => Promise<T>,
): Promise<{
  readonly observedChanges: readonly ObservedOrganizationReadModelChange[];
  readonly result: T;
}> {
  const observedStates = new Map<string, ObservedOrganizationState>();
  const result = await organizationReadModelChangeScope.run(
    observedStates,
    operation,
  );
  const observedChanges = [...observedStates]
    .flatMap(([organizationId, state]) =>
      state.cursor !== null
        ? [
            {
              affectedUserIds: [...state.affectedUserIds].sort(),
              cursor: state.cursor,
              organizationId,
            },
          ]
        : [],
    )
    .sort((left, right) =>
      left.organizationId.localeCompare(right.organizationId),
    );
  return { observedChanges, result };
}

/**
 * Keep only observations that are visible in committed cursor heads and attach
 * each organization's current active-roster audience in the same batched read.
 * Users the observed mutation recorded as access-affected join that audience:
 * a removed or disabled member is no longer an active roster row, yet is
 * exactly the user who must be woken to discover the denial.
 *
 * If the observing transaction rolled back, its head increment rolled back as
 * well. If another transaction subsequently reaches the same or a later
 * cursor, publishing is still correct because that organization did commit a
 * change that clients should reconcile.
 */
export async function listCommittedOrganizationReadModelChanges(
  db: ApiDatabase,
  observedChanges: readonly ObservedOrganizationReadModelChange[],
): Promise<CommittedOrganizationReadModelChange[]> {
  if (observedChanges.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      cursor: organizationReadModelHeads.cursor,
      organizationId: organizationReadModelHeads.organizationId,
      recipientUserId: organizationRosterEntries.userId,
    })
    .from(organizationReadModelHeads)
    .leftJoin(
      organizationRosterEntries,
      and(
        eq(
          organizationRosterEntries.organizationId,
          organizationReadModelHeads.organizationId,
        ),
        eq(organizationRosterEntries.status, "active"),
      ),
    )
    .where(
      inArray(
        organizationReadModelHeads.organizationId,
        observedChanges.map((change) => change.organizationId),
      ),
    );
  const observedByOrganizationId = new Map(
    observedChanges.map((change) => [change.organizationId, change]),
  );
  const recipientUserIdsByOrganizationId = new Map<string, Set<string>>();
  for (const row of rows) {
    const observed = observedByOrganizationId.get(row.organizationId);
    if (!observed || row.cursor < observed.cursor) {
      continue;
    }
    const recipientUserIds =
      recipientUserIdsByOrganizationId.get(row.organizationId) ??
      new Set<string>();
    if (row.recipientUserId !== null) {
      recipientUserIds.add(row.recipientUserId);
    }
    recipientUserIdsByOrganizationId.set(row.organizationId, recipientUserIds);
  }

  return observedChanges.flatMap((change) => {
    const recipientUserIds = recipientUserIdsByOrganizationId.get(
      change.organizationId,
    );
    if (!recipientUserIds) {
      return [];
    }
    for (const userId of change.affectedUserIds) {
      recipientUserIds.add(userId);
    }
    return [
      {
        ...change,
        recipientUserIds: [...recipientUserIds].sort(),
      },
    ];
  });
}

type OrganizationReadModelLane =
  | "directory"
  | "grants"
  | "groupMemberships"
  | "groups"
  | "organizationPolicy";

type WholeOrganizationReadModelLane = Exclude<
  OrganizationReadModelLane,
  "groupMemberships"
>;

/**
 * The read-model lanes one source mutation changed. Whole lanes are stamped on
 * the organization head; membership changes are stamped on each changed group
 * row and deletions on each deleted group's tombstone, so a delta can return
 * exactly the changed groups.
 */
interface OrganizationReadModelChangeInput {
  readonly organizationId: string;
  readonly deletedGroupIds?: readonly string[];
  readonly lanes?: readonly WholeOrganizationReadModelLane[];
  readonly membershipGroupIds?: readonly string[];
}

interface OrganizationReadModelChangeResult {
  readonly cursor: string;
}

/** The organization cursor head and the cursor of each lane's last change. */
export interface OrganizationReadModelHead {
  readonly cursor: bigint;
  readonly laneCursors: Readonly<Record<OrganizationReadModelLane, bigint>>;
}

const headSelection = {
  cursor: organizationReadModelHeads.cursor,
  directory: organizationReadModelHeads.directoryCursor,
  grants: organizationReadModelHeads.grantsCursor,
  groupMemberships: organizationReadModelHeads.groupMembershipsCursor,
  groups: organizationReadModelHeads.groupsCursor,
  organizationPolicy: organizationReadModelHeads.organizationPolicyCursor,
};

/**
 * Take a shared lock on an organization's cursor head for a consistent
 * authorized snapshot. Concurrent readers can proceed together while source
 * mutations, which update the head before stamping any lane, wait for the
 * snapshot transaction.
 */
export async function lockOrganizationReadModelHeadInTransaction(
  tx: DatabaseTransaction,
  organizationId: string,
): Promise<OrganizationReadModelHead | null> {
  const lockQuery = tx
    .select(headSelection)
    .from(organizationReadModelHeads)
    .where(eq(organizationReadModelHeads.organizationId, organizationId))
    .limit(1);
  const [head] = isSqliteApiDatabase()
    ? await lockQuery
    : await lockQuery.for("share");
  if (!head) {
    return null;
  }

  const { cursor, ...laneCursors } = head;
  return { cursor, laneCursors };
}

/**
 * Serialize an organization mutation before it authorizes. This prevents a
 * writer that was concurrently revoked from committing after the revocation's
 * cursor, and makes domain commit order agree with read-model cursor order.
 */
export async function lockOrganizationReadModelHeadForUpdateInTransaction(
  tx: DatabaseTransaction,
  organizationId: string,
): Promise<boolean> {
  const lockQuery = tx
    .select({ organizationId: organizationReadModelHeads.organizationId })
    .from(organizationReadModelHeads)
    .where(eq(organizationReadModelHeads.organizationId, organizationId))
    .limit(1);
  const [head] = await lockRowForUpdate(lockQuery);
  return head !== undefined;
}

const laneStampColumns = {
  directory: "directoryCursor",
  grants: "grantsCursor",
  groupMemberships: "groupMembershipsCursor",
  groups: "groupsCursor",
  organizationPolicy: "organizationPolicyCursor",
} as const satisfies Record<OrganizationReadModelLane, string>;

function changedLanes(
  input: OrganizationReadModelChangeInput,
): OrganizationReadModelLane[] {
  const lanes = new Set<OrganizationReadModelLane>(input.lanes ?? []);
  if (
    (input.membershipGroupIds?.length ?? 0) > 0 ||
    (input.deletedGroupIds?.length ?? 0) > 0
  ) {
    lanes.add("groupMemberships");
  }
  if (lanes.size === 0) {
    throw new Error("Organization read-model change names no lane");
  }
  return [...lanes];
}

/**
 * Advance the cursor and stamp every changed lane with it in one update. The
 * update holds the head row lock until commit, so stamps commit in cursor
 * order and a reader holding the shared head lock sees all or none of them.
 */
async function advanceOrganizationReadModelHead(
  tx: DatabaseTransaction,
  input: OrganizationReadModelChangeInput,
): Promise<bigint> {
  const nextCursor = sql`${organizationReadModelHeads.cursor} + 1`;
  const stamps: Partial<
    Record<(typeof laneStampColumns)[OrganizationReadModelLane], SQL>
  > = {};
  for (const lane of changedLanes(input)) {
    stamps[laneStampColumns[lane]] = nextCursor;
  }
  const [head] = await tx
    .update(organizationReadModelHeads)
    .set({ ...stamps, cursor: nextCursor, updatedAt: new Date() })
    .where(eq(organizationReadModelHeads.organizationId, input.organizationId))
    .returning({ cursor: organizationReadModelHeads.cursor });
  if (!head) {
    throw new Error("Organization read-model cursor head is missing");
  }
  return head.cursor;
}

function requireStampedRows(
  stampedIds: readonly string[],
  requestedIds: readonly string[],
): void {
  const stamped = new Set(stampedIds);
  if (requestedIds.some((id) => !stamped.has(id))) {
    throw new Error("Organization read-model group stamp target is missing");
  }
}

async function stampGroupMembershipChanges(
  tx: DatabaseTransaction,
  input: OrganizationReadModelChangeInput,
  cursor: bigint,
): Promise<void> {
  const membershipGroupIds = [...new Set(input.membershipGroupIds ?? [])];
  if (membershipGroupIds.length > 0) {
    const stamped = await tx
      .update(groups)
      .set({ membershipCursor: cursor })
      .where(
        and(
          eq(groups.organizationId, input.organizationId),
          inArray(groups.id, membershipGroupIds),
        ),
      )
      .returning({ id: groups.id });
    requireStampedRows(
      stamped.map((row) => row.id),
      membershipGroupIds,
    );
  }
  const deletedGroupIds = [...new Set(input.deletedGroupIds ?? [])];
  if (deletedGroupIds.length > 0) {
    const stamped = await tx
      .update(organizationGroupTombstones)
      .set({ deletedCursor: cursor })
      .where(
        and(
          eq(organizationGroupTombstones.organizationId, input.organizationId),
          inArray(organizationGroupTombstones.groupId, deletedGroupIds),
        ),
      )
      .returning({ id: organizationGroupTombstones.groupId });
    requireStampedRows(
      stamped.map((row) => row.id),
      deletedGroupIds,
    );
  }
}

/**
 * Record an organization read-model invalidation inside its source mutation.
 *
 * Callers must pass the active transaction so authoritative state and its
 * stamps commit or roll back together, and must skip no-op and exact-replay
 * paths before reaching this helper. A deleted group's tombstone must already
 * exist in the transaction.
 */
export async function appendOrganizationReadModelChangeInTransaction(
  tx: DatabaseTransaction,
  input: OrganizationReadModelChangeInput,
): Promise<OrganizationReadModelChangeResult> {
  const cursor = await advanceOrganizationReadModelHead(tx, input);
  await stampGroupMembershipChanges(tx, input, cursor);
  const store = organizationReadModelChangeScope.getStore();
  if (store) {
    const observed = observedOrganizationState(store, input.organizationId);
    if (observed.cursor === null || cursor > observed.cursor) {
      observed.cursor = cursor;
    }
  }

  return { cursor: cursor.toString() };
}
