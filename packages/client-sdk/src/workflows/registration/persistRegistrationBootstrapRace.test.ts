import { expect, test } from "bun:test";
import {
  createDocument,
  exportAllUpdates,
  getTextValue,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadPersistedDocumentContent } from "../documents/historyContent";
import { persistInitialDocumentBootstrap } from "./persistRegistrationBootstrap";

test("registration replay keeps the winning record and history checkpoint paired", async () => {
  const { close, execSql } = await createTestExecSql(
    "registration-document-bootstrap-race",
  );
  const localId = "registration-profile";

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const firstDoc = await createDocument("registration-bootstrap-first");
    firstDoc.getText("text").update("first profile");
    firstDoc.commit();
    const secondDoc = await createDocument("registration-bootstrap-second");
    secondDoc.getText("text").update("second profile");
    secondDoc.commit();
    const attempts = [
      {
        contentKeyBundle: "first-key-bundle",
        documentId: "first-remote-profile",
        initialUpdate: exportAllUpdates(firstDoc),
        text: getTextValue(firstDoc),
      },
      {
        contentKeyBundle: "second-key-bundle",
        documentId: "second-remote-profile",
        initialUpdate: exportAllUpdates(secondDoc),
        text: getTextValue(secondDoc),
      },
    ];

    await Promise.all(
      attempts.map((attempt) =>
        persistInitialDocumentBootstrap(execSql, {
          accessEpoch: 1,
          accessStateHash: `access-${attempt.documentId}`,
          containerId: "profiles-container",
          documentId: attempt.documentId,
          documentKind: "note",
          documentProjectors: [],
          documentState: {
            contentKeyBundle: attempt.contentKeyBundle,
            documentKekTargets: null,
            documentManifestBundle: null,
          },
          initialUpdate: attempt.initialUpdate,
          initialUpdateCommitted: false,
          localId,
        }),
      ),
    );

    const durableRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    const winner = attempts.find(
      (attempt) => attempt.documentId === durableRecord?.documentId,
    );
    if (!winner) {
      throw new Error("Expected one registration bootstrap to win");
    }
    expect(durableRecord).toMatchObject({
      accessStateHash: `access-${winner.documentId}`,
      contentKeyBundle: winner.contentKeyBundle,
      documentId: winner.documentId,
      text: winner.text,
    });
    const restored = await loadPersistedDocumentContent({
      execSql,
      localId,
      persistence: sqlDocumentsPersistence,
    });
    expect(restored && getTextValue(restored)).toBe(winner.text);
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(execSql, localId),
    ).toHaveLength(1);
  } finally {
    close();
  }
});

test("registration birth rolls back when its initial queue insert fails", async () => {
  const { close, execSql } = await createTestExecSql(
    "registration-document-bootstrap-queue-rollback",
  );
  const localId = "registration-profile-queue-failure";

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await execSql(`
      CREATE TRIGGER fail_registration_pending_update
      BEFORE INSERT ON document_pending_updates
      BEGIN
        SELECT RAISE(ABORT, 'registration pending update failed');
      END
    `);
    const doc = await createDocument("registration-bootstrap-queue-failure");
    doc.getText("text").update("must remain replayable");
    doc.commit();

    await expect(
      persistInitialDocumentBootstrap(execSql, {
        accessEpoch: 1,
        accessStateHash: "access-profile",
        containerId: "profiles-container",
        documentId: "remote-profile",
        documentKind: "note",
        documentProjectors: [],
        documentState: {
          contentKeyBundle: "profile-key-bundle",
          documentKekTargets: null,
          documentManifestBundle: null,
        },
        initialUpdate: exportAllUpdates(doc),
        initialUpdateCommitted: false,
        localId,
      }),
    ).rejects.toThrow();

    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, localId),
    ).resolves.toBeNull();
    await expect(
      loadPersistedDocumentContent({
        execSql,
        localId,
        persistence: sqlDocumentsPersistence,
      }),
    ).resolves.toBeNull();
    await expect(
      sqlDocumentsPersistence.listPendingUpdates(execSql, localId),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});
