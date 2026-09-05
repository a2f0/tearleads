import { expect, test } from "bun:test";
import {
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { loadAccessManifestCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { ensureDocumentTables } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

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
      apiClient: createMockApiClient({
        getDocumentWriterProjection: async () => writerProjection,
        syncDocument: async () => {
          throw new Error("Expected syncDocumentResult to handle sync retries");
        },
        syncDocumentResult: async (documentId, request) => {
          submittedRequests.push(request);
          current = false;
          return createMockRequestFailure({
            code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
            message: `POST /documents/${documentId}/sync: 409 Conflict: state is stale`,
            report: () => {
              reported = true;
            },
            status: 409,
          });
        },
      }),
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

test("sync planning rolls back projection checkpoints after generation expiry", async () => {
  const database = await createTestExecSql(
    "document-sync-projection-generation",
  );
  await ensureDocumentTables(database.execSql);
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const targetContainer = writerProjection.authorizingContainerPaths[0];
  if (!targetContainer) throw new Error("expected an authorizing container");
  let submitted = false;
  let transactionStarted = false;
  const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
    const rows = await database.execSql(...args);
    if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
      transactionStarted = true;
    }
    return rows;
  }) as ExecSql;

  try {
    const synced = await syncRemoteDocument({
      apiClient: createMockApiClient({
        getDocumentWriterProjection: async () => writerProjection,
        syncDocument: async () => {
          submitted = true;
          throw new Error("expired sync must not submit");
        },
      }),
      author,
      documentId: writerProjection.documentId,
      execSql: guardedExecSql,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
      stillCurrent: () => !transactionStarted,
      targetSecretKey: secretKey,
    });

    expect(synced).toBeNull();
    expect(transactionStarted).toBe(true);
    expect(submitted).toBe(false);
    await expect(
      loadAccessManifestCheckpoint(
        database.execSql,
        "container",
        author.organizationId,
        targetContainer.containerId,
      ),
    ).resolves.toBeNull();
    await expect(
      loadAccessManifestCheckpoint(
        database.execSql,
        "document",
        author.organizationId,
        writerProjection.documentId,
      ),
    ).resolves.toBeNull();
  } finally {
    database.close();
  }
});
