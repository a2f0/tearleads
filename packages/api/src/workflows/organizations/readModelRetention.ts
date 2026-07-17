import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { organizationReadModelChanges } from "@tearleads/api-shared/schema";
import { and, asc, eq, lte } from "drizzle-orm";

// The feed coalesces retained markers into lane/entity replacements, so a
// generous cursor window bounds storage and query work without making the wire
// response proportional to this count. Clients older than the window receive
// an atomic snapshot reset.
export const ORGANIZATION_READ_MODEL_RETAINED_CHANGE_COUNT = 10_000n;

/**
 * Delete a contiguous prefix of one organization's change markers.
 *
 * The caller must hold the organization's head row with an exclusive lock for
 * this entire transaction. Appending obtains that lock by updating the head;
 * any future scheduled compactor must acquire it explicitly before pruning.
 * Without that contract, a Postgres reader could validate retained coverage
 * under its shared head lock and then lose rows before loading the delta.
 */
export async function pruneOrganizationReadModelChangesInTransaction(input: {
  readonly currentCursor: bigint;
  readonly organizationId: string;
  readonly retainedChangeCount?: bigint | undefined;
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  const retainedChangeCount =
    input.retainedChangeCount ?? ORGANIZATION_READ_MODEL_RETAINED_CHANGE_COUNT;
  if (retainedChangeCount < 1n) {
    throw new Error("Organization read-model retention must keep a change");
  }
  const deleteThroughCursor = input.currentCursor - retainedChangeCount;
  if (deleteThroughCursor < 1n) {
    return;
  }

  await input.tx
    .delete(organizationReadModelChanges)
    .where(
      and(
        eq(organizationReadModelChanges.organizationId, input.organizationId),
        lte(organizationReadModelChanges.cursor, deleteThroughCursor),
      ),
    );
}

/**
 * Whether every marker after `requestedCursor` is still retained. Pruning only
 * removes a contiguous prefix while holding the organization's exclusive head
 * lock; the reader holds a shared head lock, so the earliest retained cursor is
 * a stable coverage boundary for this snapshot transaction.
 */
export async function isOrganizationReadModelCursorRetained(input: {
  readonly currentCursor: bigint;
  readonly organizationId: string;
  readonly requestedCursor: bigint;
  readonly tx: DatabaseTransaction;
}): Promise<boolean> {
  if (input.requestedCursor >= input.currentCursor) {
    return true;
  }

  const [earliest] = await input.tx
    .select({ cursor: organizationReadModelChanges.cursor })
    .from(organizationReadModelChanges)
    .where(
      eq(organizationReadModelChanges.organizationId, input.organizationId),
    )
    .orderBy(asc(organizationReadModelChanges.cursor))
    .limit(1);
  return (
    earliest !== undefined && input.requestedCursor >= earliest.cursor - 1n
  );
}
