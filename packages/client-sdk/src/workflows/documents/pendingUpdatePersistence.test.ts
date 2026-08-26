import { expect, test } from "bun:test";
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
