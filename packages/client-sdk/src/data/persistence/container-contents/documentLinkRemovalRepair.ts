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
  discardPrimaryMoves: boolean,
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
            discardPrimaryMoves
              ? undefined
              : eq(documentMoveIntents.intentType, DOCUMENT_LINK_INTENT_TYPE),
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

async function survivingIntentTarget(input: {
  tx: ClientSQLiteTransactionScope;
  intent: typeof documentMoveIntents.$inferSelect;
  intentType: string;
  removed: ReadonlySet<string>;
  targets: ReadonlyArray<typeof documentIntentLinkTargets.$inferSelect>;
}): Promise<string> {
  const { tx, intent, intentType, removed, targets } = input;
  if (
    intentType !== DOCUMENT_LINK_INTENT_TYPE ||
    !removed.has(intent.targetContainerId)
  )
    return intent.targetContainerId;
  const [remaining] = await tx
    .select()
    .from(documentContainerProjection)
    .where(eq(documentContainerProjection.documentId, intent.documentId))
    .orderBy(asc(documentContainerProjection.containerId))
    .limit(1);
  return (
    remaining?.containerId ??
    targets.find((target) => target.operation === "link")?.containerId ??
    intent.targetContainerId
  );
}

/** Runs after removed containers have been dropped from local link projections. */
async function repairRemovedLinks(input: {
  containerIds: ReadonlyArray<string>;
  discardPrimaryMoves: boolean;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { containerIds, tx } = input;
  const removed = new Set(containerIds);
  const affected = await loadAffectedIntents(
    tx,
    containerIds,
    input.discardPrimaryMoves,
  );
  for (const intent of affected) {
    const discardedMove =
      input.discardPrimaryMoves &&
      intent.intentType === DOCUMENT_MOVE_INTENT_TYPE &&
      removed.has(intent.targetContainerId);
    const intentType = discardedMove
      ? DOCUMENT_LINK_INTENT_TYPE
      : intent.intentType;
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
    if (intentType === DOCUMENT_LINK_INTENT_TYPE && targets.length === 0) {
      await tx
        .delete(documentMoveIntents)
        .where(eq(documentMoveIntents.documentId, intent.documentId))
        .run();
      continue;
    }
    const targetContainerId = await survivingIntentTarget({
      tx,
      intent,
      intentType,
      removed,
      targets,
    });
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
        intentType,
        replaceLinkedContainers: discardedMove
          ? false
          : intent.replaceLinkedContainers,
        targetContainerId,
        // The source records what the user moved. Clearing it would make
        // replay fall back to the active link and remove that link instead.
        sourceContainerId: intent.sourceContainerId,
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

export function repairLinkIntentsForRemovedContainers(input: {
  containerIds: ReadonlyArray<string>;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  return repairRemovedLinks({ ...input, discardPrimaryMoves: false });
}

/** Explicit discard cancels placement into these folders, retaining unrelated operations. */
export function discardLinkIntentsForRemovedContainers(input: {
  containerIds: ReadonlyArray<string>;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  return repairRemovedLinks({ ...input, discardPrimaryMoves: true });
}

/** An unsigned absence hint must not strand surviving additions after a 404. */
export async function rearmUnavailableLinkIntents(input: {
  containerIds: ReadonlyArray<string>;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { tx } = input;
  for (const intent of await loadAffectedIntents(
    tx,
    input.containerIds,
    false,
  )) {
    if (
      intent.intentType !== DOCUMENT_LINK_INTENT_TYPE ||
      intent.syncStatus !== "unavailable"
    )
      continue;
    // Rotate the revision to refuse completion from a pass that parked the old intent.
    const id = crypto.randomUUID();
    await tx
      .update(documentIntentLinkTargets)
      .set({ intentId: id })
      .where(eq(documentIntentLinkTargets.intentId, intent.id ?? ""))
      .run();
    await tx
      .update(documentMoveIntents)
      .set({
        id,
        syncStatus: "pending",
        lastError: null,
        lastAttemptedAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(documentMoveIntents.id, intent.id ?? ""))
      .run();
  }
}
