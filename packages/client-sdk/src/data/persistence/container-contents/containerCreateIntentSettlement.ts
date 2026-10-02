import { and, eq } from "drizzle-orm";
import {
  containerCreateIntents,
  containerMoveIntents,
} from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import {
  CONTAINER_CREATE_INTENT_TYPE,
  CONTAINER_MOVE_INTENT_TYPE,
  type ContainerMoveIntentInput,
} from "./containerContentsPersistenceTypes";
import { saveContainerMoveIntent } from "./containerMoveIntentRows";

async function markContainerCreateIntentRevisionSynced(input: {
  containerId: string;
  expectedIntentId: string;
  expectedUpdatedAt: string;
  remoteContainerId: string;
  remoteMetadataAccessStateHash: string;
  remoteMetadataDocumentId: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<boolean> {
  const updated = await input.tx
    .update(containerCreateIntents)
    .set({
      syncStatus: "synced",
      remoteContainerId: input.remoteContainerId,
      remoteMetadataDocumentId: input.remoteMetadataDocumentId,
      remoteMetadataAccessStateHash: input.remoteMetadataAccessStateHash,
      lastError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(containerCreateIntents.containerId, input.containerId),
        eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
        eq(containerCreateIntents.syncStatus, "pending"),
        eq(containerCreateIntents.id, input.expectedIntentId),
        eq(containerCreateIntents.updatedAt, input.expectedUpdatedAt),
      ),
    )
    .returning({ containerId: containerCreateIntents.containerId });
  return updated.length > 0;
}

/**
 * The move an adopted create still owes: to the desired parent, citing where
 * the folder is now. A desired parent equal to the created one means the user
 * never moved it away, so a later remote move by another writer stands.
 */
function owedCreateMove(input: {
  readonly createdParentContainerId?: string | undefined;
  readonly desiredParentContainerId: string;
  readonly supersededMovePreviousParentId: string;
}): ContainerMoveIntentInput | null {
  const desired = input.desiredParentContainerId;
  if (
    desired === input.supersededMovePreviousParentId ||
    desired === input.createdParentContainerId
  ) {
    return null;
  }
  return {
    parentContainerId: desired,
    previousParentContainerId: input.supersededMovePreviousParentId,
  };
}

/**
 * A local move of a folder the listing already carried queues its own move
 * intent, which is newer than the create's parent: it keeps its destination,
 * and now cites where the folder sits remotely rather than the parent it was
 * queued from, which never committed.
 */
async function rebaseQueuedMove(input: {
  readonly containerId: string;
  readonly supersededMovePreviousParentId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<boolean> {
  const rebased = await input.tx
    .update(containerMoveIntents)
    .set({ previousParentContainerId: input.supersededMovePreviousParentId })
    .where(
      and(
        eq(containerMoveIntents.containerId, input.containerId),
        eq(containerMoveIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
      ),
    )
    .returning({ containerId: containerMoveIntents.containerId });
  return rebased.length > 0;
}

async function queueOwedCreateMove(input: {
  readonly containerId: string;
  readonly createdParentContainerId?: string | undefined;
  readonly desiredParentContainerId: string;
  readonly supersededMovePreviousParentId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<"converted-to-move" | "synced"> {
  if (await rebaseQueuedMove(input)) return "converted-to-move";
  const moveIntent = owedCreateMove(input);
  if (!moveIntent) return "synced";
  await saveContainerMoveIntent({
    containerId: input.containerId,
    moveIntent,
    tx: input.tx,
    updatedAt: new Date().toISOString(),
  });
  return "converted-to-move";
}

export async function settleContainerCreateIntentRevision(input: {
  containerId: string;
  expectedIntentId: string;
  expectedUpdatedAt: string;
  remoteContainerId: string;
  remoteMetadataAccessStateHash: string;
  remoteMetadataDocumentId: string;
  supersededMovePreviousParentId?: string | undefined;
  createdParentContainerId?: string | undefined;
  desiredParentContainerId?: string | undefined;
  tx: ClientSQLiteTransactionScope;
}): Promise<"converted-to-move" | "superseded" | "synced"> {
  const previousParentId = input.supersededMovePreviousParentId;
  if (await markContainerCreateIntentRevisionSynced(input)) {
    // An adopted create may still owe a move: the user can move the folder
    // after its create committed.
    if (
      previousParentId === undefined ||
      input.desiredParentContainerId === undefined
    ) {
      return "synced";
    }
    return queueOwedCreateMove({
      ...input,
      desiredParentContainerId: input.desiredParentContainerId,
      supersededMovePreviousParentId: previousParentId,
    });
  }
  if (previousParentId === undefined) {
    return "superseded";
  }

  const [currentIntent] = await input.tx
    .select({
      id: containerCreateIntents.id,
      parentContainerId: containerCreateIntents.parentContainerId,
      updatedAt: containerCreateIntents.updatedAt,
    })
    .from(containerCreateIntents)
    .where(
      and(
        eq(containerCreateIntents.containerId, input.containerId),
        eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
        eq(containerCreateIntents.syncStatus, "pending"),
      ),
    )
    .limit(1);
  if (!currentIntent?.id) return "superseded";

  const adopted = await markContainerCreateIntentRevisionSynced({
    ...input,
    expectedIntentId: currentIntent.id,
    expectedUpdatedAt: currentIntent.updatedAt,
  });
  if (!adopted) return "superseded";
  return queueOwedCreateMove({
    ...input,
    desiredParentContainerId: currentIntent.parentContainerId,
    supersededMovePreviousParentId: previousParentId,
  });
}
