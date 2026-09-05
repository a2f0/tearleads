import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { getUpdateVersionVectors } from "@tearleads/loro";
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
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { createFullHistoryRotationSnapshot } from "../../../test/helpers/staleBundleSyncFixture";
import { ensureDocumentTables } from "../../data/sqlite/documentPersistence";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

test("lost inline rekey recovery retains a held-back checkpoint", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const rotationSnapshot = await createFullHistoryRotationSnapshot();
  const rotationVectors = getUpdateVersionVectors(rotationSnapshot);
  const heldBackCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440777",
    partialEndVersionVector: rotationVectors.partialEndVersionVector,
    partialStartVersionVector: "{}",
    sourceVersionVector: rotationVectors.partialEndVersionVector,
    updateData: bytesToBase64(rotationSnapshot),
  });
  const submittedRequests: DocumentSyncRequest[] = [];
  const rekeyedInputIds: string[] = [];
  const replacementId = "550e8400-e29b-41d4-a716-446655440888";
  const { close, execSql } = await createTestExecSql(
    `sync-inline-rekey-held-back-${crypto.randomUUID()}`,
  );
  await ensureDocumentTables(execSql);

  try {
    const runSync = () =>
      syncRemoteDocument({
        apiClient: createMockApiClient({
          evictDocumentWriterProjection: () => undefined,
          getDocumentWriterProjection: async () => writerProjection,
          syncDocument: async () => {
            throw new Error("Expected syncDocumentResult to handle sync");
          },
          syncDocumentResult: async (documentId, request) => {
            submittedRequests.push(request);
            if (submittedRequests.length === 1) {
              throw new Error("Simulated lost inline rekey response");
            }
            if (submittedRequests.length === 2) {
              return createMockRequestFailure({
                code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
                message: "Document update id conflict",
                status: 409,
              });
            }

            const readOnlyPlan = await buildMaterializedDocumentSyncPlan({
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
                ...readOnlyPlan.plan,
                documentId,
                request,
              }),
              ok: true,
            };
          },
        }),
        author,
        buildContainerRekeys: async (currentProjection, verification) => {
          const previousProjection =
            currentProjection.authorizingContainerPaths[0];
          if (!previousProjection) {
            throw new Error("Expected an authorizing container projection");
          }
          return [
            await buildMaterializedContainerRekeyPlan({
              author,
              execSql,
              ...verification,
              previousProjection,
              resolveProjectionUserKey,
              targetSecretKey: secretKey,
            }),
          ];
        },
        buildRotationSnapshot: async () => rotationSnapshot,
        documentId: writerProjection.documentId,
        execSql,
        localVersionVector: null,
        pendingUpdates: [heldBackCheckpoint],
        rekeyPendingUpdate: async (_lockedExecSql, id) => {
          rekeyedInputIds.push(id);
          return replacementId;
        },
        resolveProjectionUserKey,
        resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
        targetSecretKey: secretKey,
      });

    await expect(runSync()).rejects.toThrow(
      "Simulated lost inline rekey response",
    );
    const synced = await runSync();

    expect(synced).not.toBeNull();
    expect(
      submittedRequests.map((request) => request.containerRekeys?.length ?? 0),
    ).toEqual([1, 1, 0]);
    const firstCommitId = submittedRequests[0]?.inlineRekeyCommitId;
    expect(firstCommitId).toHaveLength(64);
    expect(
      submittedRequests.map((request) => request.inlineRekeyCommitId),
    ).toEqual([firstCommitId, firstCommitId, undefined]);
    expect(
      submittedRequests
        .slice(0, 2)
        .map((request) => request.outgoingUpdates.map((update) => update.id)),
    ).toEqual([
      [expect.not.stringContaining(heldBackCheckpoint.id)],
      [expect.not.stringContaining(heldBackCheckpoint.id)],
    ]);
    expect(rekeyedInputIds).toEqual([heldBackCheckpoint.id]);
    expect(synced?.rekeyedPendingUpdateIds).toEqual([replacementId]);
  } finally {
    close();
  }
});
