import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import { waitFor } from "../../../test/helpers/waitFor";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultDocumentsPersistence } from "../documents";
import { createTestContainerState } from "./container-state/containerState.testFixtures";
import { syncPendingDocumentMoveIntents } from "./documentMoveIntentSync";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

test("a generation change while document move intents load abandons replacement state", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-move-intent-generation",
  );
  let blockPendingList = false;
  let current = true;
  let pendingListStarted = false;
  let releasePendingList: () => void = () => {
    throw new Error("pending-list promise was not initialized");
  };
  let replacementExecutorCalls = 0;
  let storeOpenCalls = 0;
  const staleExecSql = (async (sql, bind, options) => {
    if (
      blockPendingList &&
      sql.toLowerCase().includes("select") &&
      sql.includes("document_move_intents") &&
      sql.toLowerCase().includes("order by")
    ) {
      pendingListStarted = true;
      await new Promise<void>((resolve) => {
        releasePendingList = resolve;
      });
    }
    return execSql(sql, bind, options);
  }) as ExecSql;
  const replacementExecSql: ExecSql = async () => {
    replacementExecutorCalls += 1;
    return [];
  };
  const state = {
    containersById: new Map(),
    resolveProjectionUserKey: async () => null,
    runtime: {
      infra: { execSql: staleExecSql },
      util: { log: () => undefined },
    } as unknown as ContainerContentsWorkflowRuntime,
  };

  try {
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(staleExecSql, {
      documentId: "remote-document",
      localId: "local-document",
      sourceContainerId: "source",
      targetContainerId: "target",
    });
    blockPendingList = true;

    const sync = syncPendingDocumentMoveIntents({
      host: {
        documentWorkflowRuntime: () => null,
        openDocumentStore: () => {
          storeOpenCalls += 1;
          throw new Error("stale move must not open a replacement store");
        },
      },
      isCurrent: () => current,
      isRemoteSyncBlocked: () => false,
      state,
    });
    await waitFor(
      () => pendingListStarted,
      "Document move sync did not reach pending intent loading.",
    );

    current = false;
    state.runtime = {
      ...state.runtime,
      infra: { ...state.runtime.infra, execSql: replacementExecSql },
    };
    releasePendingList();

    await expect(sync).resolves.toBe(0);
    expect(replacementExecutorCalls).toBe(0);
    expect(storeOpenCalls).toBe(0);
  } finally {
    close();
  }
});

test("a replacement executor gets its own denied move replay", async () => {
  const firstDatabase = await createTestExecSql(
    "document-move-intent-first-executor",
  );
  const replacementDatabase = await createTestExecSql(
    "document-move-intent-replacement-executor",
  );
  const state = {
    containersById: new Map(),
    lifecycleGeneration: 0,
    resolveProjectionUserKey: async () => null,
    runtime: {
      infra: { execSql: firstDatabase.execSql },
      util: { log: () => undefined },
    } as unknown as ContainerContentsWorkflowRuntime,
  };
  const host = {
    documentWorkflowRuntime: () => null,
    openDocumentStore: () => {
      throw new Error("a missing local document must not open a store");
    },
  };

  try {
    await defaultDocumentsPersistence.ensureSchema(replacementDatabase.execSql);
    await syncPendingDocumentMoveIntents({
      host,
      isCurrent: () => true,
      isRemoteSyncBlocked: () => false,
      state,
    });
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(
      replacementDatabase.execSql,
      {
        documentId: "replacement-remote-document",
        localId: "replacement-local-document",
        sourceContainerId: "source",
        targetContainerId: "target",
      },
    );
    await sqlDocumentMoveIntentPersistence.recordMoveIntentError(
      replacementDatabase.execSql,
      {
        denied: true,
        documentId: "replacement-remote-document",
        message: "denied before executor replacement",
      },
    );
    state.runtime = {
      ...state.runtime,
      infra: {
        ...state.runtime.infra,
        execSql: replacementDatabase.execSql,
      },
    };

    await syncPendingDocumentMoveIntents({
      host,
      isCurrent: () => true,
      isRemoteSyncBlocked: () => false,
      state,
    });

    const rows = await replacementDatabase.execSql(
      "SELECT sync_status AS syncStatus FROM document_move_intents",
    );
    expect(rows).toEqual([{ syncStatus: "blocked" }]);
  } finally {
    firstDatabase.close();
    replacementDatabase.close();
  }
});

test("a generation change at error commit cannot park a document move", async () => {
  const database = await createTestExecSql(
    "document-move-intent-error-generation",
  );
  let current = true;
  const guardedExecSql = (async (sql, bind, options) => {
    const rows = await database.execSql(sql, bind, options);
    if (
      sql.toLowerCase().includes("update") &&
      sql.includes("document_move_intents")
    ) {
      current = false;
    }
    return rows;
  }) as ExecSql;

  try {
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(guardedExecSql, {
      documentId: "remote-document",
      localId: "local-document",
      sourceContainerId: "source",
      targetContainerId: "target",
    });
    const [intent] =
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(
        guardedExecSql,
      );
    if (!intent) throw new Error("missing document move intent");

    await sqlDocumentMoveIntentPersistence.recordMoveIntentError(
      guardedExecSql,
      {
        denied: true,
        documentId: intent.documentId,
        expectedIntentId: intent.id,
        expectedUpdatedAt: intent.updatedAt,
        message: "stale denial",
        stillCurrent: () => current,
      },
    );

    const rows = await database.execSql(
      `SELECT sync_status AS syncStatus, last_error AS lastError
       FROM document_move_intents`,
    );
    expect(rows).toEqual([{ lastError: null, syncStatus: "pending" }]);
  } finally {
    database.close();
  }
});

test("stale document move identity failures do not report into a replacement", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-move-intent-stale-identity-failure",
  );
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );
  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: "access-document",
      containerId: "source",
      contentKeyBundle: null,
      documentId: "document",
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id: "local-document",
      lastCommitLsn: null,
      snapshotEndVersion: "",
      text: "",
      title: "Document",
    });
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "document",
      localId: "local-document",
      sourceContainerId: "source",
      targetContainerId: "target",
    });
    let current = true;
    const incidents: unknown[] = [];

    const synced = await syncPendingDocumentMoveIntents({
      host: {
        documentWorkflowRuntime: () => null,
        openDocumentStore: () => ({
          assertCanRotateContentKey: async () => {
            current = false;
            throw integrityError;
          },
          ensureInitialized: async () => true,
          relink: async () => null,
          requestSync: () => undefined,
          updateRuntime: () => undefined,
        }),
      },
      isCurrent: () => current,
      isRemoteSyncBlocked: () => false,
      state: {
        containersById: new Map([
          [
            "target",
            createTestContainerState({ id: "target", parentId: "root" }),
          ],
        ]),
        resolveProjectionUserKey: async () => null,
        runtime: {
          infra: { execSql },
          util: {
            log: () => undefined,
            reportSecurityIncident: async (error: unknown) => {
              incidents.push(error);
            },
          },
        } as unknown as ContainerContentsWorkflowRuntime,
      },
    });

    expect(synced).toBe(0);
    expect(incidents).toEqual([]);
    expect(
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql),
    ).toHaveLength(1);
  } finally {
    close();
  }
});
