import { sql } from "drizzle-orm";
import { containerMoveIntents } from "../../sqlite/schema";
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
    .insert(containerMoveIntents)
    .values({
      id,
      containerId,
      parentContainerId: moveIntent.parentContainerId,
      previousParentContainerId: moveIntent.previousParentContainerId ?? null,
      intentType: CONTAINER_MOVE_INTENT_TYPE,
      syncStatus: "pending",
      lastError: null,
      lastAttemptedAt: null,
      createdAt: updatedAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: containerMoveIntents.containerId,
      set: {
        // The timestamp can collide when two moves are queued in one clock
        // tick, so every enqueue also owns a fresh revision token.
        id,
        parentContainerId: moveIntent.parentContainerId,
        previousParentContainerId: sql`coalesce(${containerMoveIntents.previousParentContainerId}, ${moveIntent.previousParentContainerId ?? null})`,
        intentType: CONTAINER_MOVE_INTENT_TYPE,
        syncStatus: "pending",
        lastError: null,
        updatedAt,
      },
    })
    .run();
}
