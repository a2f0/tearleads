import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPendingUpdateFields } from "../../data/documents/documentSync";
import type { DocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { enqueuePendingDocumentUpdate } from "./pendingUpdatePersistence";

test("a no-op update still revalidates its document write fence", async () => {
  const observed: Array<[string, string | null, number | undefined]> = [];
  const documentIdentityMatches: DocumentsPersistence["documentIdentityMatches"] =
    async (
      _execSql,
      localId,
      expectedDocumentId,
      expectedRecoveryGeneration,
    ) => {
      observed.push([localId, expectedDocumentId, expectedRecoveryGeneration]);
      return false;
    };
  const persistence = {
    documentIdentityMatches,
    async enqueuePendingUpdate() {
      throw new Error("A no-op update must not enqueue a row");
    },
  } as unknown as DocumentsPersistence;

  await expect(
    enqueuePendingDocumentUpdate({
      execSql: async () => [],
      expectedDocumentId: "document-before-relink",
      expectedRecoveryGeneration: 4,
      localId: "local-1",
      persistence,
      update: new Uint8Array(),
    }),
  ).resolves.toBe(false);
  expect(observed).toEqual([["local-1", "document-before-relink", 4]]);
});

// A delta a queued local row already holds is not queued again, but the
// skip still answers to the caller's write fence, as an insert would.
test("a delta a queued local row holds still revalidates its write fence", async () => {
  const doc = await createDocument("pending-update-held");
  const before = encodeVersionVector(doc);
  doc.getText("text").update("held");
  doc.commit();
  const update = exportUpdatesSince(doc, before);
  doc.free();
  const fields = createPendingUpdateFields(update);
  if (!fields) throw new Error("Expected a delta");
  const database = await createTestExecSql(`held-${crypto.randomUUID()}`);
  const persistence = {
    documentIdentityMatches: async () => false,
    async enqueuePendingUpdate() {
      throw new Error("A held delta must not enqueue a row");
    },
    listPendingUpdates: async () => [
      { id: "queued", origin: "local", ...fields },
    ],
  } as unknown as DocumentsPersistence;
  try {
    await expect(
      enqueuePendingDocumentUpdate({
        execSql: database.execSql,
        expectedDocumentId: "document-before-relink",
        expectedRecoveryGeneration: 4,
        localId: "local-1",
        persistence,
        unlessQueued: true,
        update,
      }),
    ).resolves.toBe(false);
  } finally {
    database.close();
  }
});
