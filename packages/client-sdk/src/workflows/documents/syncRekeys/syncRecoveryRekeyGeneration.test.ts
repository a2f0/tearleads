import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  DocumentRecordRepository,
  ensureDocumentTables,
  MAX_PENDING_UPDATE_REKEYS,
} from "../../../data/persistence/documents/records";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlSchema";
import {
  rekeyAndReportUnsettledRecoveryPendingUpdates,
  rekeyUnsettledRecoveryPendingUpdates,
} from "./syncRecoveryRekey";

test("expired recovery cannot re-key after waiting for the SQL lock", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-sync-recovery-rekey-generation",
  );
  try {
    let current = true;
    let releaseLock = () => {};
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = runSerializedSqlMutation(execSql, () => lockHeld);
    const rekeyedInputIds: string[] = [];
    const recovery = rekeyUnsettledRecoveryPendingUpdates({
      execSql,
      recoveryPendingUpdatesById: new Map([
        [
          "stale-update",
          {
            id: "stale-update",
            partialEndVersionVector: "end",
            partialStartVersionVector: "start",
            updateData: "data",
          },
        ],
      ]),
      rekeyPendingUpdate: async (_lockedExecSql, id) => {
        rekeyedInputIds.push(id);
        return `next-${id}`;
      },
      settledPendingUpdateIds: [],
      stillCurrent: () => current,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    current = false;
    releaseLock();
    await Promise.all([blocker, recovery]);

    expect(await recovery).toEqual({
      exhaustedPendingUpdateIds: [],
      rekeyedPendingUpdateIds: [],
    });
    expect(rekeyedInputIds).toEqual([]);
  } finally {
    close();
  }
});

test("re-key rolls back when recovery expires before commit", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-sync-recovery-rekey-commit-generation",
  );
  const scope = { appKind: "documents", localId: "expiring-document" };
  try {
    await ensureDocumentTables(execSql);
    const records = new DocumentRecordRepository(execSql);
    const pendingUpdateId = await records.enqueueDocumentPendingUpdate(scope, {
      partialEndVersionVector: "end",
      partialStartVersionVector: "start",
      updateData: "data",
    });
    const [pendingUpdate] = await records.listDocumentPendingUpdates(scope);
    if (!pendingUpdate) throw new Error("Expected a pending update");
    let current = true;

    const result = await rekeyUnsettledRecoveryPendingUpdates({
      execSql,
      recoveryPendingUpdatesById: new Map([[pendingUpdate.id, pendingUpdate]]),
      rekeyPendingUpdate: async (lockedExecSql, id) => {
        const nextId = await new DocumentRecordRepository(
          lockedExecSql,
        ).rekeyDocumentPendingUpdate(id);
        current = false;
        return nextId;
      },
      settledPendingUpdateIds: [],
      stillCurrent: () => current,
    });

    expect(result).toEqual({
      exhaustedPendingUpdateIds: [],
      rekeyedPendingUpdateIds: [],
    });
    expect(await records.listDocumentPendingUpdates(scope)).toEqual([
      expect.objectContaining({ id: pendingUpdateId, rekeyCount: 0 }),
    ]);
  } finally {
    close();
  }
});

test("expired recovery does not classify exhausted pending updates", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-sync-recovery-expired-exhaustion",
  );
  try {
    const result = await rekeyUnsettledRecoveryPendingUpdates({
      execSql,
      recoveryPendingUpdatesById: new Map([
        [
          "exhausted-update",
          {
            id: "exhausted-update",
            partialEndVersionVector: "end",
            partialStartVersionVector: "start",
            rekeyCount: MAX_PENDING_UPDATE_REKEYS,
            updateData: "data",
          },
        ],
      ]),
      settledPendingUpdateIds: [],
      stillCurrent: () => false,
    });

    expect(result).toEqual({
      exhaustedPendingUpdateIds: [],
      rekeyedPendingUpdateIds: [],
    });
  } finally {
    close();
  }
});

test("expiration after exhaustion classification suppresses reporting", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-sync-recovery-expired-exhaustion-report",
  );
  try {
    let currentChecks = 0;
    let reportedFailures = 0;
    const result = await rekeyAndReportUnsettledRecoveryPendingUpdates({
      execSql,
      onTerminalSubmitFailure: () => {
        reportedFailures += 1;
      },
      recoveryPendingUpdatesById: new Map([
        [
          "exhausted-update",
          {
            id: "exhausted-update",
            partialEndVersionVector: "end",
            partialStartVersionVector: "start",
            rekeyCount: MAX_PENDING_UPDATE_REKEYS,
            updateData: "data",
          },
        ],
      ]),
      settledPendingUpdateIds: [],
      stillCurrent: () => {
        currentChecks += 1;
        return currentChecks < 3;
      },
    });

    expect(result).toEqual({
      exhaustedPendingUpdateCount: 0,
      rekeyedPendingUpdateIds: [],
    });
    expect(reportedFailures).toBe(0);
  } finally {
    close();
  }
});
