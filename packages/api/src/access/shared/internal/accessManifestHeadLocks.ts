import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessManifestHeads } from "@tearleads/api-shared/schema";
import type { AccessObjectKind } from "@tearleads/crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { uniqueSortedStrings as unique } from "../../../utils/array";
import { isSqliteApiDatabase } from "../../../utils/sqlDialect";
import {
  type HeldLockMode,
  recordTransactionLock,
  transactionHoldsLock,
} from "../../../utils/transactionLocks";

export interface StoredAccessManifestHead {
  readonly objectKind: AccessObjectKind;
  readonly objectId: string;
  readonly organizationId: string;
  readonly epoch: number;
  readonly manifestHash: string;
  readonly updatedAt: Date;
}

export function toStoredAccessManifestHead(
  row: typeof accessManifestHeads.$inferSelect,
): StoredAccessManifestHead {
  return {
    objectKind: row.objectKind,
    objectId: row.objectId,
    organizationId: row.organizationId,
    epoch: row.epoch,
    manifestHash: row.manifestHash,
    updatedAt: row.updatedAt,
  };
}

export function accessManifestHeadLockKey(
  objectKind: AccessObjectKind,
  objectId: string,
): string {
  return `access-manifest-head:${objectKind}:${objectId}`;
}

function heldLockMode(mode: "share" | "update"): HeldLockMode {
  return mode === "share" ? "shared" : "exclusive";
}

async function lockAccessManifestHeadRows(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: DatabaseSession,
  mode: "share" | "update",
): Promise<StoredAccessManifestHead[]> {
  const uniqueObjectIds = unique(objectIds);
  if (uniqueObjectIds.length === 0) {
    return [];
  }

  const lockQuery = executor
    .select()
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, objectKind),
        inArray(accessManifestHeads.objectId, uniqueObjectIds),
      ),
    )
    // PostgreSQL does not preserve the input order of an IN predicate. Sort
    // the rows before FOR SHARE/UPDATE acquires locks so overlapping mutation
    // plans cannot take the same manifest heads in opposite orders.
    .orderBy(asc(accessManifestHeads.objectId));

  const rows = isSqliteApiDatabase()
    ? await lockQuery
    : await lockQuery.for(mode);
  for (const row of rows) {
    recordTransactionLock(
      executor,
      accessManifestHeadLockKey(objectKind, row.objectId),
      heldLockMode(mode),
    );
  }
  return rows.map(toStoredAccessManifestHead);
}

async function lockAccessManifestHeads(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: DatabaseSession,
  mode: "share" | "update",
): Promise<readonly string[]> {
  const rows = await lockAccessManifestHeadRows(
    objectKind,
    objectIds,
    executor,
    mode,
  );
  return rows.map((head) => head.objectId);
}

/**
 * Lock the heads this transaction does not already hold in a covering mode.
 * Re-locking a held row never waits, so the skipped ids change no lock order.
 * Returns the rows it locked, keyed by object id. A locked row stays current
 * until the transaction ends, so a caller may use it instead of reading the
 * head again; held ids it skipped are absent and must be read.
 */
export async function lockUnheldAccessManifestHeads(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: DatabaseSession,
  mode: "share" | "update",
): Promise<Map<string, StoredAccessManifestHead>> {
  const unheld = objectIds.filter(
    (objectId) =>
      !transactionHoldsLock(
        executor,
        accessManifestHeadLockKey(objectKind, objectId),
        heldLockMode(mode),
      ),
  );
  const rows = await lockAccessManifestHeadRows(
    objectKind,
    unheld,
    executor,
    mode,
  );
  return new Map(rows.map((head) => [head.objectId, head]));
}

export async function lockAccessManifestHeadsForShare(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: DatabaseSession,
): Promise<readonly string[]> {
  return lockAccessManifestHeads(objectKind, objectIds, executor, "share");
}

export async function lockAccessManifestHeadsForUpdate(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: DatabaseSession,
): Promise<readonly string[]> {
  return lockAccessManifestHeads(objectKind, objectIds, executor, "update");
}
