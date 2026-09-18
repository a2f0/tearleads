import { and, asc, eq, inArray, or } from "drizzle-orm";
import { documentIntentLinkTargets } from "../../sqlite/documentPlacementIntentSchema";
import {
  documentContainerProjection,
  documentMoveIntents,
} from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import {
  DOCUMENT_LINK_INTENT_TYPE,
  DOCUMENT_MOVE_INTENT_TYPE,
} from "./documentMoveIntentPersistence";

function loadAffectedIntents(
  tx: ClientSQLiteTransactionScope,
  containerIds: ReadonlyArray<string>,
) {
  return tx
    .select()
    .from(documentMoveIntents)
    .where(
      and(
        inArray(documentMoveIntents.intentType, [
          DOCUMENT_LINK_INTENT_TYPE,
          DOCUMENT_MOVE_INTENT_TYPE,
        ]),
        or(
          and(
            eq(documentMoveIntents.intentType, DOCUMENT_LINK_INTENT_TYPE),
            inArray(documentMoveIntents.targetContainerId, containerIds),
          ),
          inArray(
            documentMoveIntents.id,
            tx
              .select({ id: documentIntentLinkTargets.intentId })
              .from(documentIntentLinkTargets)
              .where(
                inArray(documentIntentLinkTargets.containerId, containerIds),
              ),
          ),
        ),
      ),
    );
}

/** Runs after removed containers have been dropped from local link projections. */
export async function repairLinkIntentsForRemovedContainers(input: {
  containerIds: ReadonlyArray<string>;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { containerIds, tx } = input;
  const removed = new Set(containerIds);
  const affected = await loadAffectedIntents(tx, containerIds);
  for (const intent of affected) {
    const targets = (
      await tx
        .select()
        .from(documentIntentLinkTargets)
        .where(eq(documentIntentLinkTargets.intentId, intent.id ?? ""))
    ).filter(
      (target) =>
        target.operation === "unlink" || !removed.has(target.containerId),
    );
    await tx
      .delete(documentIntentLinkTargets)
      .where(eq(documentIntentLinkTargets.intentId, intent.id ?? ""))
      .run();
    if (
      intent.intentType === DOCUMENT_LINK_INTENT_TYPE &&
      targets.length === 0
    ) {
      await tx
        .delete(documentMoveIntents)
        .where(eq(documentMoveIntents.documentId, intent.documentId))
        .run();
      continue;
    }
    let targetContainerId = intent.targetContainerId;
    if (
      intent.intentType === DOCUMENT_LINK_INTENT_TYPE &&
      removed.has(targetContainerId)
    ) {
      const [remaining] = await tx
        .select()
        .from(documentContainerProjection)
        .where(eq(documentContainerProjection.documentId, intent.documentId))
        .orderBy(asc(documentContainerProjection.containerId))
        .limit(1);
      targetContainerId = remaining?.containerId ?? targetContainerId;
    }
    // A removed preferred link is only a routing hint for an additive intent.
    // Keep explicit operations for surviving containers, and invalidate any
    // replay that captured the old target set before this transaction.
    const id = crypto.randomUUID();
    if (targets.length)
      await tx
        .insert(documentIntentLinkTargets)
        .values(targets.map((target) => ({ ...target, intentId: id })))
        .run();
    const unavailable = removed.has(targetContainerId);
    await tx
      .update(documentMoveIntents)
      .set({
        id,
        targetContainerId,
        sourceContainerId:
          intent.sourceContainerId && removed.has(intent.sourceContainerId)
            ? null
            : intent.sourceContainerId,
        lastAttemptedAt: null,
        lastError: unavailable
          ? "Document placement has no surviving destination container"
          : null,
        syncStatus: unavailable ? "unavailable" : "pending",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(documentMoveIntents.documentId, intent.documentId))
      .run();
  }
}
