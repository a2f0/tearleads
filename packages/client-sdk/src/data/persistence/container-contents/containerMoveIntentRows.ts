import { sql } from "drizzle-orm";
import {
  LOCAL_INTENT_LANES,
  LOCAL_INTENT_SUBJECT,
  localIntents,
} from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import {
  CONTAINER_MOVE_INTENT_TYPE,
  type ContainerMoveIntentInput,
} from "./containerContentsPersistenceTypes";

export async function saveContainerMoveIntent(input: {
  tx: ClientSQLiteTransactionScope;
  containerId: string;
  moveIntent: ContainerMoveIntentInput;
  updatedAt: string;
}) {
  const { containerId, moveIntent, tx, updatedAt } = input;
  const id = moveIntent.id ?? crypto.randomUUID();
  await tx
    .insert(localIntents)
    .values({
      id,
      lane: LOCAL_INTENT_LANES.containerMove,
      subjectId: containerId,
      targetContainerId: moveIntent.parentContainerId,
      sourceContainerId: moveIntent.previousParentContainerId ?? null,
      intentType: CONTAINER_MOVE_INTENT_TYPE,
      syncStatus: "pending",
      lastError: null,
      lastAttemptedAt: null,
      createdAt: updatedAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: LOCAL_INTENT_SUBJECT,
      set: {
        // The timestamp can collide when two moves are queued in one clock
        // tick, so every enqueue also owns a fresh revision token.
        id,
        targetContainerId: moveIntent.parentContainerId,
        sourceContainerId: sql`coalesce(${localIntents.sourceContainerId}, ${moveIntent.previousParentContainerId ?? null})`,
        intentType: CONTAINER_MOVE_INTENT_TYPE,
        syncStatus: "pending",
        lastError: null,
        updatedAt,
      },
    })
    .run();
}
