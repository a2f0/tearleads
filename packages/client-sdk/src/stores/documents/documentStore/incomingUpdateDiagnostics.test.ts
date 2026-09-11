import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { Tearleads } from "../../../client/Tearleads";
import { DocumentSyncUpdateIsolationError } from "../../../data/documents/shared/documentSyncUpdateIsolation";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { hasRecordedTerminalSyncFailures } from "../../../data/sqlite/documentSyncFailurePersistence";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import type { DocumentState, DocumentStoreState } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { documentIncomingUpdateIsolationFailureHandler } from "./syncShared";

for (const loggerThrows of [false, true]) {
  test(`quarantine reaches the SDK logger and survives reporter failure=${loggerThrows}`, async () => {
    const database = await createTestExecSql("quarantine-diagnostics");
    const reported: unknown[] = [];
    const sdk = new Tearleads({
      logger: {
        log: () => undefined,
        logError: (_message, error) => {
          reported.push(error);
          if (loggerThrows) throw new Error("Diagnostic transport unavailable");
        },
      },
    });
    try {
      await sqlDocumentsPersistence.ensureSchema(database.execSql);
      const runtime = sdk.documents.workflowRuntime();
      const state = {
        localId: "private-local-document",
        runtime: {
          ...runtime,
          infra: { ...runtime.infra, execSql: database.execSql },
        },
      } as unknown as DocumentStoreState;
      const failure = new DocumentSyncUpdateIsolationError({
        cause: new Error("private decrypted value"),
        stage: "loro_import",
        updateId: null,
        batchUpdateIds: ["private-update"],
      });
      await documentIncomingUpdateIsolationFailureHandler(state)(failure);
      expect(reported).toEqual([failure]);
      expect(await hasRecordedTerminalSyncFailures(database.execSql)).toBe(
        true,
      );
    } finally {
      sdk.dispose();
      database.close();
    }
  });
}

test("quarantine queued behind an identity teardown is neither recorded nor reported", async () => {
  const database = await createTestExecSql("stale-quarantine-diagnostics");
  const reported: unknown[] = [];
  try {
    await sqlDocumentsPersistence.ensureSchema(database.execSql);
    const doc = {} as DocumentState;
    const state = {
      doc,
      localId: "old-identity-document",
      runtime: {
        infra: { execSql: database.execSql },
        state: { domainScope: "old-identity" },
        util: {
          logError: (_message: unknown, error: unknown) => reported.push(error),
        },
      },
    } as unknown as DocumentStoreState;
    const generation = captureDocumentStoreSyncGeneration(state, doc);
    if (!generation) throw new Error("Expected a document generation");
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const teardown = runSerializedSqlMutation(database.execSql, async () => {
      state.doc = null;
      await held;
    });
    const failure = new DocumentSyncUpdateIsolationError({
      cause: new Error("stale response"),
      stage: "decrypt",
      updateId: "old-identity-update",
    });
    const recording = documentIncomingUpdateIsolationFailureHandler(
      state,
      generation,
    )(failure);
    release();
    await teardown;
    await recording;
    expect(reported).toEqual([]);
    expect(await hasRecordedTerminalSyncFailures(database.execSql)).toBe(false);
  } finally {
    database.close();
  }
});
