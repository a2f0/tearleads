import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@symcrypt/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { ensureDocumentTables } from "../../data/sqlite/documentPersistence";

test("syncRemoteDocument does not retry after its generation expires", async () => {
  const database = await createTestExecSql("document-sync-generation-guard");
  await ensureDocumentTables(database.execSql);
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const submittedRequests: DocumentSyncRequest[] = [];
  let current = true;
  let reported = false;

  try {
    const synced = await syncRemoteDocument({
      apiClient: {
        getDocumentWriterProjection: async () => writerProjection,
        syncDocument: async () => {
          throw new Error("Expected syncDocumentResult to handle sync retries");
        },
        syncDocumentResult: async (documentId, request) => {
          submittedRequests.push(request);
          current = false;
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
            message: `POST /documents/${documentId}/sync: 409 Conflict: state is stale`,
            ok: false,
            report: () => {
              reported = true;
            },
            status: 409,
          };
        },
      },
      author,
      documentId: writerProjection.documentId,
      execSql: database.execSql,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
      stillCurrent: () => current,
      targetSecretKey: secretKey,
    });

    expect(synced).toBeNull();
    expect(submittedRequests).toHaveLength(1);
    expect(reported).toBe(false);
  } finally {
    database.close();
  }
});
