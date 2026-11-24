import { and, eq } from "drizzle-orm";
import {
  MAX_ROTATION_LEFT_OUT,
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
  return row ? parseRotationAvailability(row) : ROTATION_AVAILABLE;
}

/** Left-out update ids as stored, or null when this build cannot read them. */
function parseLeftOut(text: string | null): readonly string[] | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_ROTATION_LEFT_OUT ||
    new Set(parsed).size !== parsed.length
  ) {
    return null;
  }
  const ids = parsed.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return ids.length === parsed.length ? ids : null;
}

function parseRotationAvailability(
  row: typeof documentRotationAvailability.$inferSelect,
): RotationAvailability {
  // Only a rotation proven without its left-out updates counts from zero.
  const fewest = row.status === "leftOut" ? 0 : 1;
  if (!Number.isSafeInteger(row.deaths) || row.deaths < fewest) {
    return ROTATION_AVAILABLE;
  }
  const judged = {
    deaths: row.deaths,
    documentId: row.documentId,
    judge: row.judge,
  };
  const leftOut = parseLeftOut(row.leftOut);
  switch (row.status) {
    case "dying":
    case "unavailable":
      return { ...judged, status: row.status };
    case "leftOut":
      return leftOut && leftOut.length > 0
        ? { ...judged, leftOut, status: "leftOut" }
        : ROTATION_AVAILABLE;
    case "leavingOut":
      return leftOut && row.trying && !leftOut.includes(row.trying)
        ? { ...judged, leftOut, status: "leavingOut", trying: row.trying }
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
        ? JSON.stringify(state.leftOut)
        : null,
    status: state.status,
    trying: state.status === "leavingOut" ? state.trying : null,
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
