import { and, eq, inArray } from "drizzle-orm";
import { documentIntentLinkTargets } from "../../sqlite/documentPlacementIntentSchema";
import {
  containerCreateIntents,
  containerMoveIntents,
  documentMoveIntents,
  documentPendingUpdates,
} from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

/** Only local work makes removed metadata a recovery item; clean cache is disposable. */
export async function containerIdsWithRemovalWork(
  tx: ClientSQLiteTransactionScope,
  ids: string[],
): Promise<string[]> {
  const pending = await tx
    .select({ id: documentPendingUpdates.localId })
    .from(documentPendingUpdates)
    .where(
      and(
        eq(documentPendingUpdates.appKind, "container-metadata"),
        inArray(documentPendingUpdates.localId, ids),
      ),
    );
  const creates = await tx
    .select({ id: containerCreateIntents.containerId })
    .from(containerCreateIntents)
    .where(
      and(
        eq(containerCreateIntents.syncStatus, "pending"),
        inArray(containerCreateIntents.containerId, ids),
      ),
    );
  const moves = await tx
    .select({ id: containerMoveIntents.containerId })
    .from(containerMoveIntents)
    .where(
      and(
        inArray(containerMoveIntents.syncStatus, ["pending", "blocked"]),
        inArray(containerMoveIntents.containerId, ids),
      ),
    );
  const placements = await tx
    .select({ id: documentMoveIntents.targetContainerId })
    .from(documentMoveIntents)
    .where(inArray(documentMoveIntents.targetContainerId, ids));
  const links = await tx
    .select({ id: documentIntentLinkTargets.containerId })
    .from(documentIntentLinkTargets)
    .where(inArray(documentIntentLinkTargets.containerId, ids));
  return [
    ...new Set(
      [...pending, ...creates, ...moves, ...placements, ...links].map(
        (row) => row.id,
      ),
    ),
  ];
}
