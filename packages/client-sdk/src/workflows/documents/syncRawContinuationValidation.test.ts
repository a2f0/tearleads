import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createMaterializedSyncFixture,
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
        apiClient: {
          getDocumentWriterProjection: async () => {
            projectionFetches += 1;
            return fixture.writerProjection;
          },
          syncDocument: async () => invalidResponse,
          syncDocumentResult: async () => {
            requests += 1;
            return { data: invalidResponse, ok: true as const };
          },
        },
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
