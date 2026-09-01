import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  containerCreateIntents,
  containerMoveIntents,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import {
  CONTAINER_CREATE_INTENT_TYPE,
  CONTAINER_MOVE_INTENT_TYPE,
  type ContainerContentsPersistence,
  type ContainerCreateIntentInput,
  type ContainerCreateIntentRecord,
  type ContainerCreateIntentSyncStatus,
  type ContainerMoveIntentInput,
  type ContainerMoveIntentRecord,
  type ContainerMoveIntentSyncStatus,
} from "./containerContentsPersistenceTypes";

function parseCreateIntentSyncStatus(
  value: unknown,
): ContainerCreateIntentSyncStatus {
  return value === "synced" ? "synced" : "pending";
}

function parseMoveIntentSyncStatus(
  value: unknown,
): ContainerMoveIntentSyncStatus {
  return value === "blocked" ? "blocked" : "pending";
}

interface SelectedContainerCreateIntentRecord {
  id: string | null;
  containerId: string;
  parentContainerId: string;
  syncStatus: string;
  remoteContainerId: string | null;
  remoteMetadataDocumentId: string | null;
  remoteMetadataAccessStateHash: string | null;
  lastError: string | null;
  lastAttemptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SelectedContainerMoveIntentRecord {
  id: string | null;
  containerId: string;
  parentContainerId: string;
  previousParentContainerId: string | null;
  syncStatus: string;
  lastError: string | null;
  lastAttemptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapContainerCreateIntentRecord(
  row: SelectedContainerCreateIntentRecord,
): ContainerCreateIntentRecord {
  return {
    id: String(row.id ?? ""),
    containerId: row.containerId,
    parentContainerId: row.parentContainerId,
    intentType: CONTAINER_CREATE_INTENT_TYPE,
    syncStatus: parseCreateIntentSyncStatus(row.syncStatus),
    remoteContainerId: row.remoteContainerId,
    remoteMetadataDocumentId: row.remoteMetadataDocumentId,
    remoteMetadataAccessStateHash: row.remoteMetadataAccessStateHash,
    lastError: row.lastError,
    lastAttemptedAt: row.lastAttemptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapContainerMoveIntentRecord(
  row: SelectedContainerMoveIntentRecord,
): ContainerMoveIntentRecord {
  return {
    id: String(row.id ?? ""),
    containerId: row.containerId,
    parentContainerId: row.parentContainerId,
    previousParentContainerId: row.previousParentContainerId,
    intentType: CONTAINER_MOVE_INTENT_TYPE,
    syncStatus: parseMoveIntentSyncStatus(row.syncStatus),
    lastError: row.lastError,
    lastAttemptedAt: row.lastAttemptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function saveContainerCreateIntent(input: {
  tx: ClientSQLiteTransactionScope;
  containerId: string;
  createIntent: ContainerCreateIntentInput;
  updatedAt: string;
}) {
  const { containerId, createIntent, tx, updatedAt } = input;
  const id = createIntent.id ?? crypto.randomUUID();
  await tx
    .insert(containerCreateIntents)
    .values({
      id,
      containerId,
      parentContainerId: createIntent.parentContainerId,
      intentType: CONTAINER_CREATE_INTENT_TYPE,
      syncStatus: "pending",
      remoteContainerId: null,
      remoteMetadataDocumentId: null,
      remoteMetadataAccessStateHash: null,
      lastError: null,
      lastAttemptedAt: null,
      createdAt: updatedAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: containerCreateIntents.containerId,
      set: {
        // Timestamps can collide when a create is re-queued in one clock tick,
        // so every enqueue owns a fresh revision token too.
        id,
        parentContainerId: createIntent.parentContainerId,
        intentType: CONTAINER_CREATE_INTENT_TYPE,
        syncStatus: "pending",
        remoteContainerId: null,
        remoteMetadataDocumentId: null,
        remoteMetadataAccessStateHash: null,
        lastError: null,
        lastAttemptedAt: null,
        updatedAt,
      },
    })
    .run();
}

export class ContainerCreateIntentSupersededError extends Error {
  constructor() {
    super("Container create intent was superseded before local settlement");
  }
}

export async function markContainerCreateIntentRevisionSynced(input: {
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

export async function settleContainerCreateIntentRevision(input: {
  containerId: string;
  expectedIntentId: string;
  expectedUpdatedAt: string;
  remoteContainerId: string;
  remoteMetadataAccessStateHash: string;
  remoteMetadataDocumentId: string;
  supersededMovePreviousParentId?: string | null | undefined;
  tx: ClientSQLiteTransactionScope;
}): Promise<"converted-to-move" | "superseded" | "synced"> {
  if (await markContainerCreateIntentRevisionSynced(input)) return "synced";
  if (input.supersededMovePreviousParentId === undefined) {
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
  if (
    currentIntent.parentContainerId !== input.supersededMovePreviousParentId
  ) {
    await saveContainerMoveIntent({
      containerId: input.containerId,
      moveIntent: {
        parentContainerId: currentIntent.parentContainerId,
        previousParentContainerId: input.supersededMovePreviousParentId,
      },
      tx: input.tx,
      updatedAt: new Date().toISOString(),
    });
  }
  return "converted-to-move";
}

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

export async function deleteContainerMoveIntentRevision(input: {
  containerId: string;
  expectedIntentId: string;
  expectedUpdatedAt: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<boolean> {
  const deleted = await input.tx
    .delete(containerMoveIntents)
    .where(
      and(
        eq(containerMoveIntents.containerId, input.containerId),
        eq(containerMoveIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
        eq(containerMoveIntents.id, input.expectedIntentId),
        eq(containerMoveIntents.updatedAt, input.expectedUpdatedAt),
      ),
    )
    .returning({ containerId: containerMoveIntents.containerId });
  return deleted.length > 0;
}

type ContainerIntentPersistence = Pick<
  ContainerContentsPersistence,
  | "listPendingCreateIntents"
  | "listUnsyncedMoveIntents"
  | "recordCreateIntentError"
  | "recordMoveIntentError"
  | "markCreateIntentSynced"
  | "markMoveIntentSynced"
>;

export const containerIntentPersistence: ContainerIntentPersistence = {
  async listPendingCreateIntents(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({
        id: containerCreateIntents.id,
        containerId: containerCreateIntents.containerId,
        parentContainerId: containerCreateIntents.parentContainerId,
        syncStatus: containerCreateIntents.syncStatus,
        remoteContainerId: containerCreateIntents.remoteContainerId,
        remoteMetadataDocumentId:
          containerCreateIntents.remoteMetadataDocumentId,
        remoteMetadataAccessStateHash:
          containerCreateIntents.remoteMetadataAccessStateHash,
        lastError: containerCreateIntents.lastError,
        lastAttemptedAt: containerCreateIntents.lastAttemptedAt,
        createdAt: containerCreateIntents.createdAt,
        updatedAt: containerCreateIntents.updatedAt,
      })
      .from(containerCreateIntents)
      .where(
        and(
          eq(containerCreateIntents.syncStatus, "pending"),
          eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
        ),
      )
      .orderBy(asc(containerCreateIntents.createdAt));

    return rows.map((row) => mapContainerCreateIntentRecord(row));
  },
  async listUnsyncedMoveIntents(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    // No syncStatus filter: synced moves are deleted (see markMoveIntentSynced),
    // so every surviving row is unsynced. Blocked intents replay too: "blocked"
    // names the reason the last attempt could not proceed, not a terminal
    // verdict — the missing container can appear via hydration, after which
    // the move completes — and hydration must still not revert them.
    const rows = await db
      .select({
        id: containerMoveIntents.id,
        containerId: containerMoveIntents.containerId,
        parentContainerId: containerMoveIntents.parentContainerId,
        previousParentContainerId:
          containerMoveIntents.previousParentContainerId,
        syncStatus: containerMoveIntents.syncStatus,
        lastError: containerMoveIntents.lastError,
        lastAttemptedAt: containerMoveIntents.lastAttemptedAt,
        createdAt: containerMoveIntents.createdAt,
        updatedAt: containerMoveIntents.updatedAt,
      })
      .from(containerMoveIntents)
      .where(eq(containerMoveIntents.intentType, CONTAINER_MOVE_INTENT_TYPE))
      .orderBy(asc(containerMoveIntents.createdAt));

    return rows.map((row) => mapContainerMoveIntentRecord(row));
  },
  async recordCreateIntentError(execSql, input) {
    const runtime = getClientSQLitePersistenceRuntime(execSql);
    const record = async (tx: ClientSQLiteTransactionScope) => {
      const updatedAt = new Date().toISOString();
      await tx
        .update(containerCreateIntents)
        .set({
          lastAttemptedAt: updatedAt,
          lastError: input.message,
          updatedAt,
        })
        .where(
          and(
            eq(containerCreateIntents.containerId, input.containerId),
            eq(containerCreateIntents.syncStatus, "pending"),
            eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
            eq(containerCreateIntents.id, input.expectedIntentId),
            eq(containerCreateIntents.updatedAt, input.expectedUpdatedAt),
          ),
        )
        .run();
    };
    if (input.stillCurrent) {
      await runtime.guardedTransaction(record, input.stillCurrent, {
        behavior: "immediate",
      });
      return;
    }
    await runtime.transaction(record, { behavior: "immediate" });
  },
  async recordMoveIntentError(execSql, input) {
    const runtime = getClientSQLitePersistenceRuntime(execSql);
    const record = async (tx: ClientSQLiteTransactionScope) => {
      const updatedAt = new Date().toISOString();
      await tx
        .update(containerMoveIntents)
        .set({
          lastAttemptedAt: updatedAt,
          lastError: input.message,
          syncStatus: input.blocked ? "blocked" : "pending",
          updatedAt,
        })
        .where(
          and(
            eq(containerMoveIntents.containerId, input.containerId),
            // Blocked rows stay updatable so a retried intent records its
            // fresh outcome and a transient failure unblocks it.
            inArray(containerMoveIntents.syncStatus, ["pending", "blocked"]),
            eq(containerMoveIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
            ...(input.expectedIntentId
              ? [eq(containerMoveIntents.id, input.expectedIntentId)]
              : []),
            ...(input.expectedUpdatedAt
              ? [eq(containerMoveIntents.updatedAt, input.expectedUpdatedAt)]
              : []),
          ),
        )
        .run();
    };
    if (input.stillCurrent) {
      await runtime.guardedTransaction(record, input.stillCurrent, {
        behavior: "immediate",
      });
      return;
    }
    await runtime.transaction(record, { behavior: "immediate" });
  },
  async markCreateIntentSynced(execSql, input) {
    const outcome = await getClientSQLitePersistenceRuntime(
      execSql,
    ).guardedTransaction(
      async (tx) => {
        return settleContainerCreateIntentRevision({ ...input, tx });
      },
      input.stillCurrent,
      { behavior: "immediate" },
    );
    return outcome.committed && outcome.result !== "superseded";
  },
  async markMoveIntentSynced(execSql, input) {
    const outcome = await getClientSQLitePersistenceRuntime(
      execSql,
    ).guardedTransaction(
      async (tx) => {
        return deleteContainerMoveIntentRevision({ ...input, tx });
      },
      input.stillCurrent,
      { behavior: "immediate" },
    );
    return outcome.committed && outcome.result === true;
  },
};
