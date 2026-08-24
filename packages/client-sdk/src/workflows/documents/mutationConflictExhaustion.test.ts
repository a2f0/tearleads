import { expect, test } from "bun:test";
import { createDocument } from "@symcrypt/loro";
import type {
  DocumentsPersistence,
  StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createDocumentProjectorRegistry } from "../../documents";
import { persistDocumentState } from "./persistence";

test("document mutation conflict exhaustion fails instead of dropping the edit", async () => {
  const currentDoc = await createDocument("document-conflict-exhaustion");
  currentDoc.getText("text").update("unsaved local edit");
  currentDoc.commit();
  const currentRecord: StoredDocumentRecord = {
    accessEpoch: 1,
    containerId: "container-1",
    documentId: "remote-1",
    id: "local-document",
    snapshotEndVersion: "",
    text: "before",
  };
  let conflictCount = 0;
  const persistence = {
    commitDocumentMutation: async () => {
      conflictCount += 1;
      return { committed: false as const, currentRecord };
    },
    hasDocument: async () => true,
    loadDocument: async () => currentRecord,
    loadDocumentContainer: async () => ({ containerId: "container-1" }),
  } as unknown as DocumentsPersistence;

  await expect(
    persistDocumentState({
      currentDoc,
      currentRecord,
      documentProjectors: createDocumentProjectorRegistry([]),
      execSql: (async () => []) as ExecSql,
      localId: currentRecord.id,
      persistence,
    }),
  ).rejects.toThrow(
    "Document mutation commit gave up after 8 concurrent conflicts",
  );
  expect(conflictCount).toBe(8);
});
