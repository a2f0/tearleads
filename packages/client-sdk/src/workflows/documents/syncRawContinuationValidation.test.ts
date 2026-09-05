import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

test("an invalid empty raw continuation page is never resubmitted", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "raw-continuation-empty-invalid-page",
  );
  try {
    const materialized = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      historyMode: "raw",
      localVersionVector: null,
      pendingUpdates: [],
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.writerProjection,
    });
    const response = await createSyncResponse(materialized.plan, {
      acceptedOutgoingUpdateIds: [],
      updates: [],
    });
    const invalidResponse = {
      ...response,
      documentId: "550e8400-e29b-41d4-a716-446655440468",
    };
    const persistedState = {
      contentKeyBundle: JSON.stringify(
        fixture.writerProjection.contentKeyBundle,
      ),
      documentId: fixture.writerProjection.documentId,
      documentKekTargets: JSON.stringify(
        fixture.writerProjection.documentKekTargets,
      ),
      documentManifestBundle: JSON.stringify(
        fixture.writerProjection.documentManifest,
      ),
    };
    let requests = 0;
    let projectionFetches = 0;

    await expect(
      syncRemoteDocument({
        apiClient: createMockApiClient({
          getDocumentWriterProjection: async () => {
            projectionFetches += 1;
            return fixture.writerProjection;
          },
          syncDocument: async () => invalidResponse,
          syncDocumentResult: async () => {
            requests += 1;
            return { data: invalidResponse, ok: true as const };
          },
        }),
        author: fixture.author,
        documentId: fixture.writerProjection.documentId,
        execSql,
        historyMode: "raw",
        localVersionVector: null,
        persistedState,
        pullContinuation: {
          commitLsn: response.commitLsn ?? "0/16B6C50",
          commitLsnMode: "tracked",
          cursor: "invalid-empty-page",
        },
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        resolveWriterPublicKey: writerKeyResolver(fixture),
        targetSecretKey: fixture.secretKey,
      }),
    ).rejects.toThrow("document id mismatch");

    expect(requests).toBe(1);
    expect(projectionFetches).toBe(0);
  } finally {
    close();
  }
});

test("a plain page-two raw validation failure is never resubmitted", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "raw-continuation-plain-validation-failure",
  );
  try {
    const historicalPlan = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      localVersionVector: null,
      pendingUpdates: [
        createPendingUpdateRecord({
          id: "550e8400-e29b-41d4-a716-446655440469",
        }),
      ],
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.writerProjection,
    });
    const historicalResponse = await createSyncResponse(historicalPlan.plan);
    const update = historicalResponse.updates[0];
    if (!update) throw new Error("Expected a historical response update");
    const materialized = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      historyMode: "raw",
      localVersionVector: null,
      pendingUpdates: [],
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.writerProjection,
    });
    const persistedState = {
      contentKeyBundle: JSON.stringify(
        fixture.writerProjection.contentKeyBundle,
      ),
      documentId: fixture.writerProjection.documentId,
      documentKekTargets: JSON.stringify(
        fixture.writerProjection.documentKekTargets,
      ),
      documentManifestBundle: JSON.stringify(
        fixture.writerProjection.documentManifest,
      ),
    };
    const validationError = new Error("plain raw page validation failure");
    let requests = 0;

    await expect(
      syncRemoteDocument({
        apiClient: createMockApiClient({
          getDocumentWriterProjection: async () => fixture.writerProjection,
          syncDocument: async () => {
            throw new Error("Expected syncDocumentResult to handle raw sync");
          },
          syncDocumentResult: async (documentId, request) => {
            requests += 1;
            return {
              data: await createSyncResponse(
                { ...materialized.plan, documentId, request },
                { acceptedOutgoingUpdateIds: [], updates: [update] },
              ),
              ok: true as const,
            };
          },
        }),
        author: fixture.author,
        documentId: fixture.writerProjection.documentId,
        execSql,
        historyMode: "raw",
        localVersionVector: null,
        persistedState,
        pullContinuation: {
          commitLsn: "0/16B6C50",
          commitLsnMode: "tracked",
          cursor: "plain-validation-page-2",
        },
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        resolveWriterPublicKey: writerKeyResolver(fixture),
        targetSecretKey: fixture.secretKey,
        validateIncomingUpdates: () => {
          throw validationError;
        },
        writerProjection: fixture.writerProjection,
      }),
    ).rejects.toBe(validationError);

    expect(requests).toBe(1);
  } finally {
    close();
  }
});
