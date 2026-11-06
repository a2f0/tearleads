import { afterEach, beforeEach, expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { sealNextContentKeyEpoch } from "../../../../test/helpers/contentKeyBundleSealing";
import {
  createAuthor,
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSignedSyncResponseUpdate,
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/documentSync";
import {
  createLoroPendingUpdate,
  decryptedUpdateText,
} from "../../../../test/helpers/documentSyncFixtures";
import { persistedDocumentSyncStateFromResponse } from "../../../data/documents/shared/sync/syncResponses";
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

test("syncRemoteDocument submits a signed sync request and persists the verified response", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const submittedRequests: DocumentSyncRequest[] = [];
  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => {
        throw new Error("Unexpected writer projection fetch");
      },
      syncDocument: async (documentId, request) => {
        submittedRequests.push(request);
        const materialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection,
        });
        return createSyncResponse({
          ...materialized.plan,
          documentId,
          request,
        });
      },
    }),
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerProjection,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(submittedRequests).toHaveLength(1);
  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(synced?.response.acceptedOutgoingUpdateIds).toEqual([
    "550e8400-e29b-41d4-a716-446655440444",
  ]);
  expect(synced?.settledPendingUpdateIds).toEqual([
    "550e8400-e29b-41d4-a716-446655440444",
  ]);
  expect(
    await decryptedUpdateText(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("materialized update");
});

test("syncRemoteDocument decrypts returned updates with historical content-key bundles", async () => {
  const fixture = await createMaterializedSyncFixture();
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = fixture;
  const historicalMaterialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [await createLoroPendingUpdate("historical update")],
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
      getDocumentWriterProjection: async (documentId) =>
        documentId === currentWriterProjection.documentId
          ? currentWriterProjection
          : null,
      syncDocument: async (documentId, request) => {
        const currentMaterialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection: currentWriterProjection,
        });
        return createSyncResponse(
          {
            ...currentMaterialized.plan,
            documentId,
            request,
          },
          {
            contentKeyBundles: [writerProjection.contentKeyBundle],
            updates: [historicalUpdate],
          },
        );
      },
    }),
    author,
    documentId: currentWriterProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates: [],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(
    await decryptedUpdateText(synced?.decryptedUpdates[0]?.updateData),
  ).toBe("historical update");
});

test("document sync rejects an incoming update from a read-only writer", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
  });
  const { author: ungrantedWriter, signingPublicKey } = await createAuthor();
  ungrantedWriter.signerUserId = "read-only-writer";
  const update = await createSignedSyncResponseUpdate({
    accessManifestHash: materialized.plan.expectedLinkSetManifestHash,
    author: ungrantedWriter,
    plan: materialized.plan,
    targetHash: materialized.plan.expectedTargetHash,
  });

  await expect(
    persistedDocumentSyncStateFromResponse(
      materialized.plan,
      await createSyncResponse(materialized.plan, {
        acceptedOutgoingUpdateIds: [],
        updates: [update],
      }),
      {
        resolveWriterPublicKey: async () => signingPublicKey,
      },
    ),
  ).rejects.toThrow("signer lacks write access");
});

test("document sync rejects substituted writer-authorization targets", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);
  const update = response.updates[0];
  const target = update?.authorizationTargets?.[0];
  if (!update || !target) {
    throw new Error("Expected writer-authorization target fixture");
  }

  await expect(
    persistedDocumentSyncStateFromResponse(
      materialized.plan,
      {
        ...response,
        updates: [
          {
            ...update,
            authorizationTargets: [
              { ...target, containerManifestHash: "0".repeat(64) },
            ],
          },
        ],
      },
      { resolveWriterPublicKey: async () => signingPublicKey },
    ),
  ).rejects.toThrow("write targets are not canonical");
});
