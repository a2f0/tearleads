import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { createFullHistoryRotationSnapshot } from "../../../test/helpers/staleBundleSyncFixture";
import { DocumentRawHistoryUnavailableError } from "./syncContentKeys";
import { buildDocumentSyncPlan } from "./syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

test("raw submitted-result refresh preserves an unavailable error when projection fetch fails", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "raw-submitted-result-null-refresh",
  );
  const materializedUpdate = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  const responseUpdate = (await createSyncResponse(materializedUpdate.plan))
    .updates[0];
  if (!responseUpdate) throw new Error("Expected a response update");
  const unavailableError = new DocumentRawHistoryUnavailableError(
    1,
    new Error("cached projection omitted a predecessor key"),
  );
  let projectionFetches = 0;
  let submissions = 0;

  try {
    await expect(
      syncRemoteDocument({
        apiClient: {
          evictDocumentWriterProjection: () => undefined,
          getDocumentWriterProjection: async () => {
            projectionFetches += 1;
            return null;
          },
          syncDocument: async (_documentId, request) => {
            submissions += 1;
            const plan = await syncPlanFromRequest(
              fixture,
              request,
              fixture.writerProjection,
            );
            return createSyncResponse(plan, {
              acceptedOutgoingUpdateIds: [],
              updates: [responseUpdate],
            });
          },
        },
        author: fixture.author,
        documentId: fixture.writerProjection.documentId,
        execSql,
        historyMode: "raw",
        localVersionVector: null,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        resolveWriterPublicKey: writerKeyResolver(fixture),
        targetSecretKey: fixture.secretKey,
        validateIncomingUpdates: () => {
          throw unavailableError;
        },
        writerProjection: fixture.writerProjection,
      }),
    ).rejects.toBe(unavailableError);
    expect(projectionFetches).toBe(1);
    expect(submissions).toBe(1);
  } finally {
    close();
  }
});

test("raw submitted-result refresh keeps the frozen response plan", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "raw-submitted-result-frozen-plan",
  );
  try {
    const staleProjection = {
      ...fixture.writerProjection,
      contentKeyBundleStale: true as const,
    };
    const frozenPlan = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      historyMode: "raw",
      localVersionVector: null,
      pendingUpdates: [],
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: staleProjection,
    });
    const updatePlan = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.writerProjection,
    });
    const responseUpdate = (await createSyncResponse(updatePlan.plan))
      .updates[0];
    if (!responseUpdate) throw new Error("Expected a response update");
    const frozenResponse = await createSyncResponse(frozenPlan.plan, {
      acceptedOutgoingUpdateIds: [],
      updates: [responseUpdate],
    });
    const heal = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: staleProjection,
    });
    const healedBundle = heal.plan.request.contentKeyBundle;
    if (!healedBundle) throw new Error("Expected a healed content-key bundle");
    const healedProjection = {
      ...fixture.writerProjection,
      contentKeyBundle: {
        ...healedBundle,
        documentId: fixture.writerProjection.documentId,
      },
    };
    let projectionFetches = 0;
    let submissions = 0;
    let validateCalls = 0;

    const synced = await syncRemoteDocument({
      apiClient: {
        evictDocumentWriterProjection: () => undefined,
        getDocumentWriterProjection: async () => {
          projectionFetches += 1;
          return healedProjection;
        },
        syncDocument: async () => {
          submissions += 1;
          return frozenResponse;
        },
      },
      author: fixture.author,
      documentId: fixture.writerProjection.documentId,
      execSql,
      historyMode: "raw",
      localVersionVector: null,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver(fixture),
      targetSecretKey: fixture.secretKey,
      validateIncomingUpdates: () => {
        validateCalls += 1;
        if (validateCalls === 1) {
          throw new DocumentRawHistoryUnavailableError(
            1,
            new Error("submitted response needs refreshed KEK paths"),
          );
        }
      },
      writerProjection: staleProjection,
    });

    expect(synced?.writerProjection).toBe(healedProjection);
    expect(validateCalls).toBe(2);
    expect(projectionFetches).toBe(1);
    expect(submissions).toBe(1);
  } finally {
    close();
  }
});

async function syncPlanFromRequest(
  fixture: Awaited<ReturnType<typeof createMaterializedSyncFixture>>,
  request: DocumentSyncRequest,
  writerProjection: typeof fixture.writerProjection,
) {
  const plan = await buildDocumentSyncPlan({
    author: fixture.author,
    contentKeyBundle: writerProjection.contentKeyBundle,
    documentId: writerProjection.documentId,
    documentKekTargets: writerProjection.documentKekTargets,
    documentManifest: writerProjection.documentManifest,
    historyMode: request.historyMode,
    localVersionVector: request.localVersionVector,
  });
  return { ...plan, request };
}
