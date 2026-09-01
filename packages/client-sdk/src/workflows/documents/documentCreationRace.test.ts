import { expect, test } from "bun:test";
import { createDocument, getTextValue } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadPersistedDocumentContent } from "./historyContent";
import { persistDocumentState } from "./persistence";

test("concurrent initializers keep one document identity and birth checkpoint", async () => {
  const { close, execSql } = await createTestExecSql("document-creation-race");
  const localId = "shared-local-document";

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const firstDoc = await createDocument("document-creation-race-first");
    firstDoc.getText("text").update("first initializer");
    firstDoc.commit();
    const secondDoc = await createDocument("document-creation-race-second");
    secondDoc.getText("text").update("second initializer");
    secondDoc.commit();
    const attempts = [
      {
        currentDoc: firstDoc,
        documentId: "remote-first",
        keyBundle: "key-first",
        continuation: {
          commitLsn: "0/1",
          commitLsnMode: "tracked" as const,
          cursor: "cursor-first",
        },
      },
      {
        currentDoc: secondDoc,
        documentId: "remote-second",
        keyBundle: "key-second",
        continuation: {
          commitLsn: "0/2",
          commitLsnMode: "tracked" as const,
          cursor: "cursor-second",
        },
      },
    ];

    const results = await Promise.all(
      attempts.map((attempt) =>
        persistDocumentState({
          currentDoc: attempt.currentDoc,
          currentRecord: null,
          documentProjectors: defaultDocumentProjectorRegistry,
          execSql,
          localId,
          patch: {
            accessStateHash: `access-${attempt.documentId}`,
            contentKeyBundle: attempt.keyBundle,
            documentId: attempt.documentId,
            pullContinuation: attempt.continuation,
          },
          persistence: sqlDocumentsPersistence,
        }),
      ),
    );
    const winnerIndex = results.findIndex(
      (result) => result && !result.creationSuperseded,
    );
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const winner = attempts[winnerIndex];
    const loser = results[loserIndex];
    if (!winner) {
      throw new Error("Expected one document initializer to win");
    }

    expect(results.filter((result) => result?.creationSuperseded)).toHaveLength(
      1,
    );
    expect(loser).toMatchObject({
      creationSuperseded: true,
      pullContinuationSuperseded: true,
      syncIdentitySuperseded: true,
    });
    const durableRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    expect(durableRecord).toMatchObject({
      accessStateHash: `access-${winner.documentId}`,
      contentKeyBundle: winner.keyBundle,
      documentId: winner.documentId,
      pullContinuation: winner.continuation,
      text: getTextValue(winner.currentDoc),
    });
    const restored = await loadPersistedDocumentContent({
      execSql,
      localId,
      persistence: sqlDocumentsPersistence,
    });
    expect(restored && getTextValue(restored)).toBe(
      getTextValue(winner.currentDoc),
    );
  } finally {
    close();
  }
});

test("initial creation stops when its lifecycle expires before the transaction", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-creation-lifecycle-race",
  );
  const localId = "stale-lifecycle-document";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const doc = await createDocument("document-creation-stale-lifecycle");
    doc.getText("text").update("must not persist");
    doc.commit();
    let isCurrent = true;
    const persistence = {
      ...sqlDocumentsPersistence,
      createDocumentWithHistoryCheckpoint: async (
        ...input: Parameters<
          typeof sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint
        >
      ) => {
        isCurrent = false;
        return sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
          ...input,
        );
      },
    };

    await expect(
      persistDocumentState({
        canStartDurableMutation: () => isCurrent,
        currentDoc: doc,
        currentRecord: null,
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
        localId,
        persistence,
      }),
    ).resolves.toBeNull();
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, localId),
    ).resolves.toBeNull();
    await expect(
      sqlDocumentsPersistence.loadHistoryRestoreState(execSql, localId),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
