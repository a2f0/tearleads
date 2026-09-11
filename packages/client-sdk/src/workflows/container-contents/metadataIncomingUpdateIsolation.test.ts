import { expect, test } from "bun:test";
import {
  createDocument,
  exportFullHistorySnapshot,
  getTextValue,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import {
  ensureDocumentTables,
  hasRecordedTerminalSyncFailures,
} from "../../data/sqlite/documentPersistence";
import { runSerializedSqlMutation } from "../../data/sqlite/sqlSchema";
import {
  applyIncomingContainerMetadataUpdates,
  metadataIncomingUpdateIsolation,
  recordCurrentMetadataSyncFailure,
} from "./metadataIncomingUpdateIsolation";

test("metadata live import applies rotation snapshots before ordinary updates", async () => {
  const current = await createDocument("metadata-checkpoint-current");
  const rotated = await createDocument("metadata-checkpoint-rotated");
  rotated.getText("text").update("rotation baseline");
  rotated.commit();
  const snapshot = exportFullHistorySnapshot(rotated);
  const vectors = getUpdateVersionVectors(snapshot);

  applyIncomingContainerMetadataUpdates(current, {
    decryptedUpdates: [
      {
        checkpointKind: "rotate_baseline",
        checkpointPayloadKind: "full_history_snapshot",
        id: "550e8400-e29b-41d4-a716-4466554400cc",
        ...vectors,
        sourceVersionVector: vectors.partialEndVersionVector,
        updateData: snapshot,
      },
    ],
  });

  expect(getTextValue(current)).toBe("rotation baseline");
});

test("expired metadata quarantine cannot record or report across the SQL lock", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-failure-generation",
  );
  try {
    await ensureDocumentTables(execSql);
    let current = true;
    const reported: unknown[] = [];
    let releaseLock = () => {};
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = runSerializedSqlMutation(execSql, () => lockHeld);
    const isolation = metadataIncomingUpdateIsolation({
      currentDocument: await createDocument("metadata-expired"),
      execSql,
      isCurrent: () => current,
      logError: (_message, error) => reported.push(error),
      metadataScope: {
        appKind: "container-metadata",
        localId: "container-expired",
      },
    });
    const recording = isolation.onIncomingUpdateIsolationFailure(
      new DocumentSyncUpdateIsolationError({
        cause: new Error("stale metadata failure"),
        stage: "loro_import",
        updateId: null,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    current = false;
    releaseLock();
    await Promise.all([blocker, recording]);

    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
    expect(reported).toEqual([]);
  } finally {
    close();
  }
});

test("metadata quarantine preserves the original error and durable row when reporting rejects", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-quarantine-diagnostics",
  );
  try {
    await ensureDocumentTables(execSql);
    const failure = new DocumentSyncUpdateIsolationError({
      cause: new Error("private metadata payload"),
      stage: "loro_import",
      updateId: null,
    });
    const reported: unknown[] = [];
    const isolation = metadataIncomingUpdateIsolation({
      currentDocument: await createDocument("metadata-quarantined"),
      execSql,
      isCurrent: () => true,
      logError: (_message, error) => {
        reported.push(error);
        return Promise.reject(new Error("Diagnostic transport unavailable"));
      },
      metadataScope: {
        appKind: "container-metadata",
        localId: "container-quarantined",
      },
    });

    await isolation.onIncomingUpdateIsolationFailure(failure);

    expect(reported).toEqual([failure]);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(true);
  } finally {
    close();
  }
});

test("metadata failure recording rolls back when generation expires before commit", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-failure-commit-generation",
  );
  try {
    await ensureDocumentTables(execSql);
    let checks = 0;

    await recordCurrentMetadataSyncFailure({
      execSql,
      failure: {
        attemptedAt: "2026-09-01T00:00:00.000Z",
        message: "rolled-back metadata failure",
        status: 500,
      },
      isCurrent: () => {
        checks += 1;
        return checks === 1;
      },
      metadataScope: {
        appKind: "container-metadata",
        localId: "container-expired-before-commit",
      },
    });

    expect(checks).toBe(2);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
  } finally {
    close();
  }
});
