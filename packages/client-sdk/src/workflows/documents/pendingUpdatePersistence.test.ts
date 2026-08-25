import { expect, test } from "bun:test";
import type { DocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { enqueuePendingDocumentUpdate } from "./pendingUpdatePersistence";

test("a no-op update still revalidates its document identity", async () => {
  const observed: Array<[string, string | null]> = [];
  const documentIdentityMatches: DocumentsPersistence["documentIdentityMatches"] =
    async (_execSql, localId, expectedDocumentId) => {
      observed.push([localId, expectedDocumentId]);
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
      localId: "local-1",
      persistence,
      update: new Uint8Array(),
    }),
  ).resolves.toBe(false);
  expect(observed).toEqual([["local-1", "document-before-relink"]]);
});
