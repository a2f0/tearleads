import { and, eq, inArray } from "drizzle-orm";
import { listLocalIdsWithQueuedUpdates } from "../../sqlite/documentPersistence/documentPendingUpdatePersistence";
import {
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../sqlite/schema";
import { documentIntentLinkTargets } from "../../sqlite/schema/documentPlacementIntentSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

/** Only local work makes removed metadata a recovery item; clean cache is disposable. */
export async function containerIdsWithRemovalWork(
  tx: ClientSQLiteTransactionScope,
  ids: string[],
): Promise<string[]> {
  const pending = (
    await listLocalIdsWithQueuedUpdates(tx, "container-metadata", ids)
  ).map((id) => ({ id }));
  const creates = await tx
    .select({ id: localIntents.subjectId })
    .from(localIntents)
    .where(
      and(
        inLocalIntentLane(LOCAL_INTENT_LANES.containerCreate),
        eq(localIntents.syncStatus, "pending"),
        inArray(localIntents.subjectId, ids),
      ),
    );
  const moves = await tx
    .select({ id: localIntents.subjectId })
    .from(localIntents)
    .where(
      and(
        inLocalIntentLane(LOCAL_INTENT_LANES.containerMove),
        inArray(localIntents.syncStatus, ["pending", "blocked"]),
        inArray(localIntents.subjectId, ids),
      ),
    );
  const placements = await tx
    .select({ id: localIntents.targetContainerId })
    .from(localIntents)
    .where(
      and(
        inLocalIntentLane(LOCAL_INTENT_LANES.documentPlacement),
        inArray(localIntents.targetContainerId, ids),
      ),
    );
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
