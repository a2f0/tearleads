import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { sealNextContentKeyEpoch } from "../../../../test/helpers/contentKeyBundleSealing";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/documentSync";
import {
  createLoroPendingUpdate,
  decryptedUpdateText,
} from "../../../../test/helpers/documentSyncFixtures";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql("document-sync"));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

test("syncRemoteDocument recovers pending write id conflicts with a read-only sync", async () => {
  const fixture = await createMaterializedSyncFixture();
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = fixture;
  const pendingUpdate = await createLoroPendingUpdate("settled update");
  const historicalMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });
  const historicalResponse = await createSyncResponse(
    historicalMaterialized.plan,
  );
  const historicalUpdate = historicalResponse.updates[0];
  if (!historicalUpdate) {
    throw new Error("Expected historical update fixture");
  }
  const currentWriterProjection: DocumentWriterProjectionResponse = {
    ...writerProjection,
    contentKeyBundle: await sealNextContentKeyEpoch(fixture),
  };
  const submittedOutgoingCounts: number[] = [];
  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async (documentId) =>
        documentId === currentWriterProjection.documentId
          ? currentWriterProjection
          : null,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle recovery");
      },
      syncDocumentResult: async (documentId, request) => {
        submittedOutgoingCounts.push(request.outgoingUpdates.length);
        if (submittedOutgoingCounts.length === 1) {
          const message = `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`;
          return {
            kind: "http",
            method: "POST",
            path: "mock-request",
            statusText: "",
            code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            message,
            ok: false,
            report: () => undefined,
            status: 409,
          };
        }

        const currentMaterialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection: currentWriterProjection,
        });
        return {
          data: await createSyncResponse(
            {
              ...currentMaterialized.plan,
              documentId,
              request,
            },
            {
              contentKeyBundles: [writerProjection.contentKeyBundle],
              updates: [historicalUpdate],
            },
          ),
          ok: true,
        };
      },
    }),
    author,
    documentId: currentWriterProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(submittedOutgoingCounts).toEqual([1, 0]);
  expect(synced?.response.acceptedOutgoingUpdateIds).toEqual([]);
  expect(synced?.settledPendingUpdateIds).toEqual([pendingUpdate.id]);
  expect(
    await decryptedUpdateText(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("settled update");
});

test("syncRemoteDocument does not settle recovered pending conflicts with different content", async () => {
  const fixture = await createMaterializedSyncFixture();
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = fixture;
  const pendingUpdate = await createLoroPendingUpdate("local update");
  const remoteUpdate = await createLoroPendingUpdate(
    "remote update",
    pendingUpdate.id,
  );
  const historicalMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [remoteUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });
  const historicalResponse = await createSyncResponse(
    historicalMaterialized.plan,
  );
  const historicalUpdate = historicalResponse.updates[0];
  if (!historicalUpdate) {
    throw new Error("Expected historical update fixture");
  }
  const currentWriterProjection: DocumentWriterProjectionResponse = {
    ...writerProjection,
    contentKeyBundle: await sealNextContentKeyEpoch(fixture),
  };
  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => currentWriterProjection,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle recovery");
      },
      syncDocumentResult: async (documentId, request) => {
        if (request.outgoingUpdates.length > 0) {
          return createMockRequestFailure({
            code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            message: `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`,
            status: 409,
          });
        }

        const currentMaterialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection: currentWriterProjection,
        });
        return {
          data: await createSyncResponse(
            {
              ...currentMaterialized.plan,
              documentId,
              request,
            },
            {
              contentKeyBundles: [writerProjection.contentKeyBundle],
              updates: [historicalUpdate],
            },
          ),
          ok: true,
        };
      },
    }),
    author,
    documentId: currentWriterProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(synced?.settledPendingUpdateIds).toEqual([]);
  expect(
    await decryptedUpdateText(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("remote update");
});

test("syncRemoteDocument replans once after a stale document sync conflict", async () => {
  const {
    author,
    projection,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const submittedRequests: DocumentSyncRequest[] = [];
  const reportedErrors: string[] = [];
  let projectionRequestCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async (documentId) => {
        if (documentId !== writerProjection.documentId) {
          return null;
        }

        projectionRequestCount += 1;
        return writerProjection;
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle sync retries");
      },
      syncDocumentResult: async (documentId, request) => {
        submittedRequests.push(request);

        if (submittedRequests.length === 1) {
          const message = `POST /documents/${documentId}/sync: 409 Conflict: authorizingContainerPathRefs[0][0] is stale`;
          return {
            kind: "http",
            method: "POST",
            path: "mock-request",
            statusText: "",
            code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
            message,
            ok: false,
            report: () => {
              reportedErrors.push(message);
            },
            status: 409,
          };
        }

        const materialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [createPendingUpdateRecord()],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection,
        });
        return {
          data: await createSyncResponse({
            ...materialized.plan,
            documentId,
            request,
          }),
          ok: true,
        };
      },
    }),
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(projectionRequestCount).toBe(2);
  expect(submittedRequests).toHaveLength(2);
  expect(reportedErrors).toEqual([]);
  expect(
    submittedRequests[1]?.authorizingContainerPathRefs?.[0]?.[0]?.manifestHash,
  ).toBe(projection.path[0]?.manifestHash);
});
