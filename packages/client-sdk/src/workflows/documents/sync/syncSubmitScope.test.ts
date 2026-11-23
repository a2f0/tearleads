import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createPendingUpdateRecord,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/workflows/documentSync";
import { persistedStateFromProjection } from "../../../../test/helpers/workflows/documentSyncFixtures";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";

// A pass with queued writes plans from the served projection; a clean probe
// plans from the persisted state.
const PASSES = ["write", "read-only"] as const;

for (const pass of PASSES) {
  test.each(SCOPE_RETIREMENTS)(
    `a ${pass} sync submit that expires after %s is not renewed or replayed`,
    async (change) => {
      const database = await createTestExecSql(
        `document-sync-scope-${pass}-${change}`,
      );
      await ensureDocumentTables(database.execSql);
      const {
        author,
        resolveProjectionUserKey,
        secretKey,
        signingPublicKey,
        writerProjection,
      } = await createMaterializedSyncFixture();
      const { documentId } = writerProjection;
      const server = createExpiringApiServer({
        method: "POST",
        path: new RegExp(`^/documents/${documentId}/sync$`),
      });
      let current = true;
      try {
        const synced = syncRemoteDocument({
          apiClient: createMockApiClient({
            getDocumentWriterProjection: async () => writerProjection,
            syncDocument: async () => {
              throw new Error("Expected syncDocumentResult");
            },
            syncDocumentResult: server.api.syncDocumentResult,
          }),
          author,
          documentId,
          execSql: database.execSql,
          localVersionVector: null,
          pendingUpdates: pass === "write" ? [createPendingUpdateRecord()] : [],
          persistedState:
            pass === "read-only"
              ? persistedStateFromProjection(writerProjection)
              : undefined,
          resolveProjectionUserKey,
          resolveWriterPublicKey: writerKeyResolver({
            author,
            signingPublicKey,
          }),
          stillCurrent: () => current,
          targetSecretKey: secretKey,
        });
        await server.entered;
        current = false;
        server.retire(change);
        server.release();
        expect(await synced).toBeNull();
        expect(server.requests).toEqual([`POST /documents/${documentId}/sync`]);
        expect(server.renewals.count).toBe(0);
      } finally {
        server.stop();
        database.close();
      }
    },
    15_000,
  );
}
