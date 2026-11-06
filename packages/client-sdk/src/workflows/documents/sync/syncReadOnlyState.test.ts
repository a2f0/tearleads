import { afterEach, beforeEach, expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/documentSync";
import {
  decryptedUpdateText,
  persistedStateFromProjection,
} from "../../../../test/helpers/documentSyncFixtures";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildDocumentSyncPlan } from "../syncPlan/syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql("document-sync"));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

test("syncRemoteDocument uses persisted state for clean read-only sync probes", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const submittedRequests: DocumentSyncRequest[] = [];
  let projectionRequestCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async (documentId) => {
        if (documentId === writerProjection.documentId) {
          projectionRequestCount += 1;
        }
        return writerProjection;
      },
      syncDocument: async (documentId, request) => {
        submittedRequests.push(request);
        const plan = await buildDocumentSyncPlan({
          author,
          contentKeyBundle: writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: writerProjection.documentKekTargets,
          documentManifest: writerProjection.documentManifest,
          localVersionVector: null,
        });
        return createSyncResponse({
          ...plan,
          documentId,
          request,
        });
      },
    }),
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [],
    persistedState: persistedStateFromProjection(writerProjection),
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
  });

  expect(projectionRequestCount).toBe(0);
  expect(submittedRequests).toHaveLength(1);
  expect(submittedRequests[0]?.outgoingUpdates).toEqual([]);
  expect(synced?.decryptedUpdates).toEqual([]);
  expect(synced?.settledPendingUpdateIds).toEqual([]);
  expect(synced?.writerProjection).toBeUndefined();
});

test("syncRemoteDocument reuses a writer projection to process persisted read-only response updates", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const remoteMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
  });
  const remoteResponse = await createSyncResponse(remoteMaterialized.plan);
  const remoteUpdate = remoteResponse.updates[0];
  if (!remoteUpdate) {
    throw new Error("Expected remote update fixture");
  }

  const submittedRequests: DocumentSyncRequest[] = [];
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
      syncDocument: async (documentId, request) => {
        submittedRequests.push(request);
        const readOnlyPlan = await buildDocumentSyncPlan({
          author,
          contentKeyBundle: writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: writerProjection.documentKekTargets,
          documentManifest: writerProjection.documentManifest,
          localVersionVector: null,
        });
        return createSyncResponse(
          {
            ...readOnlyPlan,
            documentId,
            request,
          },
          {
            acceptedOutgoingUpdateIds: [],
            updates: [remoteUpdate],
          },
        );
      },
    }),
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [],
    persistedState: persistedStateFromProjection(writerProjection),
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(projectionRequestCount).toBe(0);
  expect(submittedRequests).toHaveLength(1);
  expect(
    await decryptedUpdateText(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("materialized update");
});

test("syncRemoteDocument falls back to writer projection when persisted read-only state is stale", async () => {
  const {
    author,
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
          const message = "Document content-key bundle is stale";
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
          pendingUpdates: [],
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
    pendingUpdates: [],
    persistedState: persistedStateFromProjection(writerProjection),
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
  });

  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(projectionRequestCount).toBe(1);
  expect(submittedRequests).toHaveLength(2);
  expect(reportedErrors).toEqual([]);
});
