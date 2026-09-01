import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  type OrganizationReadModelLane,
  type OrganizationReadModelOperation,
  organizationReadModelChanges,
  organizationReadModelHeads,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { isSqliteApiDatabase, lockRowForUpdate } from "../../utils/sqlDialect";
import { pruneOrganizationReadModelChangesInTransaction } from "./readModelRetention";

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

interface OrganizationReadModelChangeInput {
  readonly organizationId: string;
  readonly lane: OrganizationReadModelLane;
  readonly entityId: string;
  readonly operation: OrganizationReadModelOperation;
}

interface OrganizationReadModelChangeResult {
  readonly cursor: string;
}

/**
 * Take a shared lock on an organization's cursor head for a consistent
 * authorized snapshot. Concurrent readers can proceed together while source
 * mutations, which update the head, wait for the snapshot transaction.
 */
export async function lockOrganizationReadModelHeadInTransaction(
  tx: DatabaseTransaction,
  organizationId: string,
): Promise<bigint | null> {
  const lockQuery = tx
    .select({ cursor: organizationReadModelHeads.cursor })
    .from(organizationReadModelHeads)
    .where(eq(organizationReadModelHeads.organizationId, organizationId))
    .limit(1);
  const [head] = isSqliteApiDatabase()
    ? await lockQuery
    : await lockQuery.for("share");
  if (!head) {
    return null;
  }

  return head.cursor;
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

/**
 * Append an organization read-model invalidation inside its source mutation.
 *
 * Callers must pass the active transaction so authoritative state and its
 * marker commit or roll back together. Callers must skip no-op and exact-replay
 * paths before reaching this helper.
 */
export async function appendOrganizationReadModelChangeInTransaction(
  tx: DatabaseTransaction,
  input: OrganizationReadModelChangeInput,
): Promise<OrganizationReadModelChangeResult> {
  const [head] = await tx
    .update(organizationReadModelHeads)
    .set({
      cursor: sql`${organizationReadModelHeads.cursor} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(organizationReadModelHeads.organizationId, input.organizationId))
    .returning({ cursor: organizationReadModelHeads.cursor });
  if (!head) {
    throw new Error("Organization read-model cursor head is missing");
  }

  await tx.insert(organizationReadModelChanges).values({
    ...input,
    cursor: head.cursor,
  });
  await pruneOrganizationReadModelChangesInTransaction({
    currentCursor: head.cursor,
    organizationId: input.organizationId,
    tx,
  });
  const store = organizationReadModelChangeScope.getStore();
  if (store) {
    const observed = observedOrganizationState(store, input.organizationId);
    if (observed.cursor === null || head.cursor > observed.cursor) {
      observed.cursor = head.cursor;
    }
  }

  return { cursor: head.cursor.toString() };
}
