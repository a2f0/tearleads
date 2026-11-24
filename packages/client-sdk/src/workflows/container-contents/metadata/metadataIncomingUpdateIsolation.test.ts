import { expect, spyOn, test } from "bun:test";
import {
  createDocument,
  exportFullHistorySnapshot,
  getTextValue,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { processLoroRuntimeFailures } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import {
  DocumentRecordRepository,
  ensureDocumentTables,
} from "../../../data/persistence/documents/records";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlSchema";
import { createDocumentSyncLoroWindow } from "../../documents/sync/loroPassWindow";
import {
  applyIncomingContainerMetadataUpdates,
  metadataIncomingUpdateIsolation,
  recordCurrentMetadataSyncFailure,
} from "./metadataIncomingUpdateIsolation";

// A failure is recorded on the scope's `documents` row, which a syncing
// metadata document always has.
async function seedMetadataRow(
  execSql: Parameters<typeof ensureDocumentTables>[0],
  localId: string,
): Promise<void> {
  await ensureDocumentTables(execSql);
  await execSql(
    "INSERT INTO documents (app_kind, local_id, updated_at) VALUES ('container-metadata', ?, '2026-10-14T00:00:00.000Z')",
    [localId],
  );
}

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
  const records = new DocumentRecordRepository(execSql);
  try {
    await seedMetadataRow(execSql, "container-expired");
    let current = true;
    const reported: unknown[] = [];
    let releaseLock = () => {};
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = runSerializedSqlMutation(execSql, () => lockHeld);
    const isolation = metadataIncomingUpdateIsolation({
      currentDocument: await createDocument("metadata-expired"),
      documentId: "550e8400-e29b-41d4-a716-446655440990",
      execSql,
      loroWindow: createDocumentSyncLoroWindow(),
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

    expect(await records.hasRecordedTerminalSyncFailures()).toBe(false);
    expect(reported).toEqual([]);
  } finally {
    close();
  }
});

test("metadata quarantine preserves the original error and durable row when reporting rejects", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-quarantine-diagnostics",
  );
  const records = new DocumentRecordRepository(execSql);
  try {
    await seedMetadataRow(execSql, "container-quarantined");
    const failure = new DocumentSyncUpdateIsolationError({
      cause: new Error("private metadata payload"),
      stage: "loro_import",
      updateId: null,
    });
    const reported: unknown[] = [];
    const isolation = metadataIncomingUpdateIsolation({
      currentDocument: await createDocument("metadata-quarantined"),
      documentId: "550e8400-e29b-41d4-a716-446655440990",
      execSql,
      loroWindow: createDocumentSyncLoroWindow(),
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
    await isolation.onIncomingUpdateIsolationFailure(failure);

    expect(reported).toEqual([failure]);
    expect(await records.hasRecordedTerminalSyncFailures()).toBe(true);
  } finally {
    close();
  }
});

test("metadata failure recording rolls back when generation expires before commit", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-failure-commit-generation",
  );
  const records = new DocumentRecordRepository(execSql);
  try {
    await seedMetadataRow(execSql, "container-expired-before-commit");
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
    expect(await records.hasRecordedTerminalSyncFailures()).toBe(false);
  } finally {
    close();
  }
});

test("a runtime failure applying judged metadata updates marks the process as failed", async () => {
  const noted = spyOn(
    processLoroRuntimeFailures,
    "noteUnattributedFailure",
  ).mockImplementation(() => undefined);
  const document = await createDocument("metadata-live-import");
  try {
    const trap = new WebAssembly.RuntimeError("unreachable");
    const trapped = {
      dependencyVersionVector: "",
      id: crypto.randomUUID(),
      partialEndVersionVector: "",
      partialStartVersionVector: "",
      get updateData(): Uint8Array {
        throw trap;
      },
    };
    expect(() =>
      applyIncomingContainerMetadataUpdates(document, {
        decryptedUpdates: [trapped],
      }),
    ).toThrow(trap);
    expect(noted).toHaveBeenCalledTimes(1);
  } finally {
    noted.mockRestore();
    document.free();
  }
});
