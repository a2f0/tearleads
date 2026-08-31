import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { waitFor } from "../../../test/helpers/waitFor";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
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
