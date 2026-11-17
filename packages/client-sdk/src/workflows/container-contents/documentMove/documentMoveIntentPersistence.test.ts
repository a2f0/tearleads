import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentMoveIntentRepository } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { defaultDocumentsPersistence } from "../../documents";

// A queued move for a deleted document can never replay; the row must go with
// the document instead of rendering a permanent phantom queue entry.
test.each(["move", "link"] as const)(
  "deleting a document deletes its queued %s intents",
  async (kind) => {
    const { close, execSql } = await createTestExecSql(
      "containerContents-document-move-delete-cleanup",
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
      const moveIntents = new DocumentMoveIntentRepository(execSql);
      await moveIntents[
        kind === "link" ? "enqueueLinkIntent" : "enqueueMoveIntent"
      ]({
        documentId: "document",
        localId: "local-document",
        sourceContainerId: "source",
        targetContainerId: "target",
      });

      await defaultDocumentsPersistence.deleteDocument(
        execSql,
        "local-document",
      );

      expect(await moveIntents.listPendingMoveIntents()).toEqual([]);
      expect(
        await execSql("SELECT * FROM document_intent_link_targets"),
      ).toEqual([]);
    } finally {
      close();
    }
  },
);
