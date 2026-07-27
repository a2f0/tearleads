import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { DOCUMENTS_APP_KIND } from "../../../data/persistence/documents/internal/constants";
import {
  hasRecordedTerminalSyncFailures,
  listDocumentPendingUpdates,
  recordDocumentSyncFailure,
} from "../../../data/sqlite/documentPersistence";
import { documents } from "../../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { DocumentsRuntime } from "../types";
import { discardDocumentStoreLocalState } from "./discard";
import { createDocumentStoreState } from "./state";

function createRuntime(execSql: ExecSql): DocumentsRuntime {
  return {
    infra: {
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: { domainScope: createDomainScope() },
    util: { log: () => undefined },
  } as unknown as DocumentsRuntime;
}

async function insertDocumentRecord(
  execSql: ExecSql,
  localId: string,
  documentId: string | null,
): Promise<void> {
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db.insert(documents).values({
      appKind: DOCUMENTS_APP_KIND,
      localId,
      documentId,
      loroSnapshot: "",
      updatedAt: new Date().toISOString(),
    });
  });
}

test("discard tears down a stuck remote document and clears its failure", async () => {
  const { close, execSql } = await createTestExecSql("discard-remote");
  const localId = "discard-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await insertDocumentRecord(execSql, localId, "remote-doc");
    // The stuck shape this action exists for: a queued update the server
    // conflicts forever, plus its recorded terminal failure.
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId,
      partialEndVersionVector: "end",
      partialStartVersionVector: "start",
      updateData: "poisoned-bytes",
    });
    await recordDocumentSyncFailure(
      execSql,
      { appKind: DOCUMENTS_APP_KIND, localId },
      {
        attemptedAt: new Date().toISOString(),
        message: "Update conflict recovery gave up after 5 re-key attempts",
        status: null,
      },
    );
    const state = createDocumentStoreState(
      localId,
      createRuntime(execSql),
      sqlDocumentsPersistence,
      {
        emitPersistedDocument: () => undefined,
        registerDocumentIdentity: () => undefined,
      },
      "remote-doc",
    );
    state.initialized = true;

    expect(await discardDocumentStoreLocalState(state)).toBe(true);

    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, localId),
    ).toBeNull();
    expect(
      await listDocumentPendingUpdates(execSql, {
        appKind: DOCUMENTS_APP_KIND,
        localId,
      }),
    ).toEqual([]);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
    // The store no longer claims the torn-down record; priming re-creates a
    // fresh one from the server copy.
    expect(state.record).toBeNull();
  } finally {
    close();
  }
});

test("discard refuses a local-only document whose queue is its only copy", async () => {
  const { close, execSql } = await createTestExecSql("discard-local-only");
  const localId = "local-only-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await insertDocumentRecord(execSql, localId, null);
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId,
      partialEndVersionVector: "end",
      partialStartVersionVector: "start",
      updateData: "only-copy-bytes",
    });
    const state = createDocumentStoreState(
      localId,
      createRuntime(execSql),
      sqlDocumentsPersistence,
      {
        emitPersistedDocument: () => undefined,
        registerDocumentIdentity: () => undefined,
      },
      null,
    );
    state.initialized = true;

    expect(await discardDocumentStoreLocalState(state)).toBe(false);

    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, localId),
    ).not.toBeNull();
    expect(
      await listDocumentPendingUpdates(execSql, {
        appKind: DOCUMENTS_APP_KIND,
        localId,
      }),
    ).toHaveLength(1);
  } finally {
    close();
  }
});
