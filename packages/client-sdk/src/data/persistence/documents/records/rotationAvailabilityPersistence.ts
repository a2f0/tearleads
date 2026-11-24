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
  if (!row || !Number.isSafeInteger(row.deaths) || row.deaths < 1) {
    return ROTATION_AVAILABLE;
  }
  const judged = {
    deaths: row.deaths,
    documentId: row.documentId,
    judge: row.judge,
  };
  if (row.status === "dying") return { ...judged, status: "dying" };
  if (row.status === "unavailable") return { ...judged, status: "unavailable" };
  return ROTATION_AVAILABLE;
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
