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
  await tx
    .insert(containerCreateIntents)
    .values({
      id: createIntent.id ?? crypto.randomUUID(),
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

export async function saveContainerMoveIntent(input: {
  tx: ClientSQLiteTransactionScope;
  containerId: string;
  moveIntent: ContainerMoveIntentInput;
  updatedAt: string;
}) {
  const { containerId, moveIntent, tx, updatedAt } = input;
  await tx
    .insert(containerMoveIntents)
    .values({
      id: moveIntent.id ?? crypto.randomUUID(),
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

type ContainerIntentPersistence = Pick<
  ContainerContentsPersistence,
  | "listPendingCreateIntents"
  | "listPendingMoveIntents"
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
  async listPendingMoveIntents(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
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
      // Blocked intents replay too: "blocked" names the reason the last
      // attempt could not proceed, not a terminal verdict — the missing
      // container can appear via hydration, after which the move completes.
      .where(
        and(
          inArray(containerMoveIntents.syncStatus, ["pending", "blocked"]),
          eq(containerMoveIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
        ),
      )
      .orderBy(asc(containerMoveIntents.createdAt));

    return rows.map((row) => mapContainerMoveIntentRecord(row));
  },

  async listUnsyncedMoveIntents(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    // No syncStatus filter: synced moves are deleted (see markMoveIntentSynced),
    // so every surviving row is unsynced, including 'blocked' ones, which
    // hydration must still not revert.
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
  async recordCreateIntentError(execSql, containerId, message) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      const updatedAt = new Date().toISOString();
      await db
        .update(containerCreateIntents)
        .set({
          lastAttemptedAt: updatedAt,
          lastError: message,
          updatedAt,
        })
        .where(
          and(
            eq(containerCreateIntents.containerId, containerId),
            eq(containerCreateIntents.syncStatus, "pending"),
            eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
          ),
        )
        .run();
    });
  },
  async recordMoveIntentError(execSql, input) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      const updatedAt = new Date().toISOString();
      await db
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
          ),
        )
        .run();
    });
  },
  async markCreateIntentSynced(execSql, input) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
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
            // Only mark synced if the row is still the one this pass consumed. A
            // user re-queue across the create network await rewrites the row with
            // a fresh updatedAt; that intent must stay pending for the next pass.
            eq(containerCreateIntents.updatedAt, input.expectedUpdatedAt),
          ),
        )
        .run();
    });
  },
  async markMoveIntentSynced(execSql, input) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(containerMoveIntents)
        .where(
          and(
            eq(containerMoveIntents.containerId, input.containerId),
            eq(containerMoveIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
            // Only clear the intent this pass consumed. If the user re-queued the
            // move during the network round-trip, the row's updatedAt advanced
            // and this delete no-ops, preserving the new destination for sync.
            eq(containerMoveIntents.updatedAt, input.expectedUpdatedAt),
          ),
        )
        .run();
    });
  },
};
