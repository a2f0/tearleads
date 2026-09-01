import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../documents/documentsPersistence";
import { sqlDocumentMoveIntentPersistence } from "./documentMoveIntentPersistence";

test("an overtaken move intent rolls its stale document relink back", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-move-intent-atomic-settlement",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: "access-1",
      containerId: "source",
      contentKeyBundle: null,
      documentId: "document-1",
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id: "local-1",
      lastCommitLsn: null,
      snapshotEndVersion: "",
      text: "body",
      title: "Title",
    });
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "document-1",
      localId: "local-1",
      sourceContainerId: "source",
      targetContainerId: "stale-target",
    });
    const [staleIntent] =
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql);
    const currentDocument = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "local-1",
    );
    expect(staleIntent).toBeDefined();
    expect(currentDocument).not.toBeNull();
    if (!staleIntent || !currentDocument) return;

    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "document-1",
      localId: "local-1",
      sourceContainerId: "source",
      targetContainerId: "winning-target",
    });

    await expect(
      sqlDocumentsPersistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: { ...currentDocument, containerId: "stale-target" },
          expectedRecord: currentDocument,
          settleAcceptedPendingOnConflict: false,
        },
        async (transactionExecSql) => {
          const settled =
            await sqlDocumentMoveIntentPersistence.markMoveIntentSynced(
              transactionExecSql,
              {
                documentId: staleIntent.documentId,
                expectedIntentId: staleIntent.id,
                expectedUpdatedAt: staleIntent.updatedAt,
              },
            );
          if (!settled) throw new Error("move intent was overtaken");
        },
      ),
    ).rejects.toThrow("move intent was overtaken");

    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, "local-1"))
        ?.containerId,
    ).toBe("source");
    expect(
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql),
    ).toEqual([
      expect.objectContaining({
        syncStatus: "pending",
        targetContainerId: "winning-target",
      }),
    ]);
  } finally {
    close();
  }
});
