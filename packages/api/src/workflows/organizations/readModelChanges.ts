import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  type OrganizationReadModelLane,
  type OrganizationReadModelOperation,
  organizationReadModelChanges,
  organizationReadModelHeads,
} from "@tearleads/api-shared/schema";
import { eq, sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";

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
  const [head] = isSqliteApiDatabase()
    ? await lockQuery
    : await lockQuery.for("update");
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

  return { cursor: head.cursor.toString() };
}
