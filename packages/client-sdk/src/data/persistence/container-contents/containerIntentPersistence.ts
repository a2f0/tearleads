import { and, asc, eq, inArray } from "drizzle-orm";
import {
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  LOCAL_INTENT_SUBJECT,
  localIntents,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  CONTAINER_CREATE_INTENT_TYPE,
  CONTAINER_MOVE_INTENT_TYPE,
  type ContainerContentsPersistence,
  type ContainerCreateIntentErrorInput,
  type ContainerCreateIntentInput,
  type ContainerCreateIntentRecord,
  type ContainerCreateIntentRevisionInput,
  type ContainerCreateIntentSyncStatus,
  type ContainerMoveIntentRecord,
  type ContainerMoveIntentRevisionInput,
  type ContainerMoveIntentSyncStatus,
} from "./containerContentsPersistenceTypes";
import { settleContainerCreateIntentRevision } from "./containerCreateIntentSettlement";

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
    .insert(localIntents)
    .values({
      id,
      lane: LOCAL_INTENT_LANES.containerCreate,
      subjectId: containerId,
      targetContainerId: createIntent.parentContainerId,
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
      target: LOCAL_INTENT_SUBJECT,
      set: {
        // Timestamps can collide when a create is re-queued in one clock tick,
        // so every enqueue owns a fresh revision token too.
        id,
        targetContainerId: createIntent.parentContainerId,
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

export async function deleteContainerMoveIntentRevision(input: {
  containerId: string;
  expectedIntentId: string;
  expectedUpdatedAt: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<boolean> {
  const deleted = await input.tx
    .delete(localIntents)
    .where(
      and(
        inLocalIntentLane(LOCAL_INTENT_LANES.containerMove),
        eq(localIntents.subjectId, input.containerId),
        eq(localIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
        eq(localIntents.id, input.expectedIntentId),
        eq(localIntents.updatedAt, input.expectedUpdatedAt),
      ),
    )
    .returning({ containerId: localIntents.subjectId });
  return deleted.length > 0;
}

async function recordCreateIntentErrorAttempt(
  execSql: ExecSql,
  input: ContainerCreateIntentErrorInput,
): Promise<void> {
  const {
    containerId,
    expectedIntentId,
    expectedUpdatedAt,
    message,
    stillCurrent,
  } = input;
  if (!message) throw new Error("Container create intent error is required");
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const record = async (tx: ClientSQLiteTransactionScope) => {
    const updatedAt = new Date().toISOString();
    await tx
      .update(localIntents)
      .set({
        lastAttemptedAt: updatedAt,
        lastError: message,
        updatedAt,
      })
      .where(
        and(
          inLocalIntentLane(LOCAL_INTENT_LANES.containerCreate),
          eq(localIntents.subjectId, containerId),
          eq(localIntents.syncStatus, "pending"),
          eq(localIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
          eq(localIntents.id, expectedIntentId),
          eq(localIntents.updatedAt, expectedUpdatedAt),
        ),
      )
      .run();
  };
  if (stillCurrent) {
    await runtime.guardedTransaction(record, stillCurrent, {
      behavior: "immediate",
    });
    return;
  }
  await runtime.transaction(record, { behavior: "immediate" });
}

async function markMoveIntentRevisionSynced(
  execSql: ExecSql,
  input: ContainerMoveIntentRevisionInput,
): Promise<boolean> {
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
}

async function markCreateIntentRevisionSynced(
  execSql: ExecSql,
  input: ContainerCreateIntentRevisionInput,
): Promise<boolean> {
  const outcome = await getClientSQLitePersistenceRuntime(
    execSql,
  ).guardedTransaction(
    async (tx) => settleContainerCreateIntentRevision({ ...input, tx }),
    input.stillCurrent,
    { behavior: "immediate" },
  );
  return outcome.committed && outcome.result !== "superseded";
}

type ContainerIntentPersistence = Pick<
  ContainerContentsPersistence,
  | "listPendingCreateIntents"
  | "listUnsyncedMoveIntents"
  | "recordCreateIntentRevisionError"
  | "recordMoveIntentError"
  | "markCreateIntentRevisionSynced"
  | "markMoveIntentRevisionSynced"
>;

export const containerIntentPersistence = {
  async listPendingCreateIntents(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({
        id: localIntents.id,
        containerId: localIntents.subjectId,
        parentContainerId: localIntents.targetContainerId,
        syncStatus: localIntents.syncStatus,
        remoteContainerId: localIntents.remoteContainerId,
        remoteMetadataDocumentId: localIntents.remoteMetadataDocumentId,
        remoteMetadataAccessStateHash:
          localIntents.remoteMetadataAccessStateHash,
        lastError: localIntents.lastError,
        lastAttemptedAt: localIntents.lastAttemptedAt,
        createdAt: localIntents.createdAt,
        updatedAt: localIntents.updatedAt,
      })
      .from(localIntents)
      .where(
        and(
          inLocalIntentLane(LOCAL_INTENT_LANES.containerCreate),
          eq(localIntents.syncStatus, "pending"),
          eq(localIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
        ),
      )
      .orderBy(asc(localIntents.createdAt));

    return rows.map((row) => mapContainerCreateIntentRecord(row));
  },
  async listUnsyncedMoveIntents(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    // No status filter: markMoveIntentRevisionSynced deletes settled rows,
    // so every surviving row is unsynced. Blocked intents replay too: "blocked"
    // names the reason the last attempt could not proceed, not a terminal
    // verdict — the missing container can appear via hydration, after which
    // the move completes — and hydration must still not revert them.
    const rows = await db
      .select({
        id: localIntents.id,
        containerId: localIntents.subjectId,
        parentContainerId: localIntents.targetContainerId,
        previousParentContainerId: localIntents.sourceContainerId,
        syncStatus: localIntents.syncStatus,
        lastError: localIntents.lastError,
        lastAttemptedAt: localIntents.lastAttemptedAt,
        createdAt: localIntents.createdAt,
        updatedAt: localIntents.updatedAt,
      })
      .from(localIntents)
      .where(
        and(
          inLocalIntentLane(LOCAL_INTENT_LANES.containerMove),
          eq(localIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
        ),
      )
      .orderBy(asc(localIntents.createdAt));

    return rows.map((row) => mapContainerMoveIntentRecord(row));
  },
  recordCreateIntentRevisionError: (execSql, input) =>
    recordCreateIntentErrorAttempt(execSql, input),
  async recordMoveIntentError(execSql, input) {
    const runtime = getClientSQLitePersistenceRuntime(execSql);
    const record = async (tx: ClientSQLiteTransactionScope) => {
      const updatedAt = new Date().toISOString();
      await tx
        .update(localIntents)
        .set({
          lastAttemptedAt: updatedAt,
          lastError: input.message,
          syncStatus: input.blocked ? "blocked" : "pending",
          updatedAt,
        })
        .where(
          and(
            inLocalIntentLane(LOCAL_INTENT_LANES.containerMove),
            eq(localIntents.subjectId, input.containerId),
            // Blocked rows stay updatable so a retried intent records its
            // fresh outcome and a transient failure unblocks it.
            inArray(localIntents.syncStatus, ["pending", "blocked"]),
            eq(localIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
            ...(input.expectedIntentId
              ? [eq(localIntents.id, input.expectedIntentId)]
              : []),
            ...(input.expectedUpdatedAt
              ? [eq(localIntents.updatedAt, input.expectedUpdatedAt)]
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
  markCreateIntentRevisionSynced,
  markMoveIntentRevisionSynced,
} satisfies ContainerIntentPersistence;
