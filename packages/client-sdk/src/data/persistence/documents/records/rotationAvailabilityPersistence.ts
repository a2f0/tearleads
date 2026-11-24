import { and, eq } from "drizzle-orm";
import {
  ROTATION_AVAILABLE,
  type RotationAvailability,
} from "../../../documents/shared/sync/rotationAvailabilityMachine";
import { documentRotationAvailability } from "../../../sqlite/schema/documentLoroWindowSchema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentScope } from "./documentPersistenceTypes";

function availabilityScope(scope: DocumentScope) {
  return and(
    eq(documentRotationAvailability.appKind, scope.appKind),
    eq(documentRotationAvailability.localId, scope.localId),
  );
}

/**
 * The scope's stored rotation availability. A row this build cannot read
 * stands for none, so it never keeps a device from rotating.
 */
export async function readRotationAvailability(
  db: Pick<ClientSQLiteTransactionScope, "select">,
  scope: DocumentScope,
): Promise<RotationAvailability> {
  const [row] = await db
    .select()
    .from(documentRotationAvailability)
    .where(availabilityScope(scope))
    .limit(1)
    .all();
  // Only a rotation proven without its left-out update counts from zero.
  const fewest = row?.status === "leftOut" ? 0 : 1;
  if (!row || !Number.isSafeInteger(row.deaths) || row.deaths < fewest) {
    return ROTATION_AVAILABLE;
  }
  const judged = {
    deaths: row.deaths,
    documentId: row.documentId,
    judge: row.judge,
  };
  switch (row.status) {
    case "dying":
    case "unavailable":
      return { ...judged, status: row.status };
    case "leavingOut":
    case "leftOut":
      return row.leftOut
        ? { ...judged, leftOut: row.leftOut, status: row.status }
        : ROTATION_AVAILABLE;
    default:
      return ROTATION_AVAILABLE;
  }
}

export async function writeRotationAvailabilityInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete" | "insert">,
  scope: DocumentScope,
  state: RotationAvailability,
  changedAt: string,
): Promise<void> {
  if (state.status === "available") {
    await tx
      .delete(documentRotationAvailability)
      .where(availabilityScope(scope))
      .run();
    return;
  }
  const values = {
    changedAt,
    deaths: state.deaths,
    documentId: state.documentId,
    judge: state.judge,
    leftOut:
      state.status === "leavingOut" || state.status === "leftOut"
        ? state.leftOut
        : null,
    status: state.status,
  };
  await tx
    .insert(documentRotationAvailability)
    .values({ ...values, appKind: scope.appKind, localId: scope.localId })
    .onConflictDoUpdate({
      set: values,
      target: [
        documentRotationAvailability.appKind,
        documentRotationAvailability.localId,
      ],
    })
    .run();
}
