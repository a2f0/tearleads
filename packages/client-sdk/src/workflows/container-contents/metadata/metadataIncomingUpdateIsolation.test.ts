import { expect, spyOn, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportHistorySegments,
  getImportBlobMetadata,
  getTextValue,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { SMALL_BASELINE_SEGMENTS } from "../../../../test/helpers/data/rotationBaselineFixtures";
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

// A metadata document is served the baseline group any document is: its
// history as update blobs, which the live copy imports with the page.
test("metadata live import applies a rotation baseline's segments as updates", async () => {
  const current = await createDocument("metadata-baseline-current");
  const rotated = await createDocument("metadata-baseline-rotated");
  for (let round = 0; round < 12; round += 1) {
    rotated.getText("text").insert(0, `rotation baseline round ${round}\n`);
    rotated.commit();
  }
  const baselineId = crypto.randomUUID();
  const segments = [...exportHistorySegments(rotated, SMALL_BASELINE_SEGMENTS)];
  expect(segments.length).toBeGreaterThan(1);

  const applied = applyIncomingContainerMetadataUpdates(current, {
    decryptedUpdates: segments.map((segment) => {
      expect(getImportBlobMetadata(segment.update).mode).toBe("update");
      return {
        baselineId,
        id: crypto.randomUUID(),
        ...getUpdateVersionVectors(segment.update),
        updateData: segment.update,
      };
    }),
  });

  expect(applied).toBe(true);
  expect(getTextValue(current)).toBe(getTextValue(rotated));
  expect(encodeVersionVector(current)).toBe(encodeVersionVector(rotated));
  expect(exportFullHistoryIdentity(current)).toBe(
    exportFullHistoryIdentity(rotated),
  );
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
