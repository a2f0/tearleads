import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentMoveIntentRepository } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  DocumentRotationUnavailableError,
  defaultDocumentsPersistence,
} from "../../documents";
import { createTestContainerState } from "../container-state/containerState.testFixtures";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { syncPendingDocumentMoveIntents } from "./documentMoveIntentSync";

async function queueMove(execSql: ExecSql): Promise<void> {
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
  await new DocumentMoveIntentRepository(execSql).enqueueMoveIntent({
    documentId: "document",
    localId: "local-document",
    sourceContainerId: "source",
    targetContainerId: "target",
  });
}

// A device whose rotation of the document is unavailable cannot prove the
// unlink, and other members can: the move parks as a denial, out of every
// structural pass until the next launch, instead of replaying each pass.
test("a move this device cannot rotate for parks as denied", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-move-rotation-unavailable",
  );
  try {
    await queueMove(execSql);

    expect(
      await syncPendingDocumentMoveIntents({
        isCreatePending: () => false,
        host: {
          documentWorkflowRuntime: () => null,
          openDocumentStore: () => ({
            assertCanRotateContentKey: async () => {
              throw new DocumentRotationUnavailableError();
            },
            ensureInitialized: async () => true,
            relink: async () => null,
            requestSync: () => undefined,
            updateRuntime: () => undefined,
          }),
        },
        isCurrent: () => true,
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
            util: { log: () => undefined },
          } as unknown as ContainerContentsWorkflowRuntime,
        },
      }),
    ).toBe(0);

    const intents = new DocumentMoveIntentRepository(execSql);
    expect(await intents.listPendingMoveIntents()).toEqual([]);
    expect(
      await execSql(
        "SELECT sync_status AS syncStatus, last_error AS lastError FROM local_intents WHERE lane = 'document.placement'",
      ),
    ).toEqual([
      {
        lastError: expect.stringContaining("other members can rotate it"),
        syncStatus: "denied",
      },
    ]);
  } finally {
    close();
  }
});
