import { expect, test } from "bun:test";
import {
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/workflows/documentSync";
import { createLoroPendingUpdate } from "../../../../test/helpers/workflows/documentSyncFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { createFullHistoryRotationSnapshot } from "../../../../test/helpers/workflows/staleBundleSyncFixture";
import { documentContainerProjections } from "../../../data/keyingProjectionVerification/document/documentContainerProjections";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import { buildMaterializedContainerRekeyPlan } from "../../containers/child/rekey";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

// An inline rekey moves the document's key target, so the request that
// carries it heals the content-key bundle: a fresh rotation baseline goes
// ahead of the queued update. The baseline is built for each request and is
// no queue row, so recovery re-keys the queued update alone.
test("lost inline rekey recovery re-keys the queued update its heal carried", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const rotationSnapshot = await createFullHistoryRotationSnapshot();
  const queuedUpdate = await createLoroPendingUpdate(
    "queued behind the inline rekey",
    "550e8400-e29b-41d4-a716-446655440777",
  );
  const submittedRequests: DocumentSyncRequest[] = [];
  const rekeyedInputIds: string[] = [];
  const replacementId = "550e8400-e29b-41d4-a716-446655440888";
  const { close, execSql } = await createTestExecSql(
    `sync-inline-rekey-recovery-${crypto.randomUUID()}`,
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
            documentContainerProjections(currentProjection)[0];
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
        pendingUpdates: [queuedUpdate],
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
    // Both write-bearing requests send a one-segment baseline, then the
    // queued update under its own id. The recovery pull sends nothing.
    const writeRequests = submittedRequests.slice(0, 2);
    expect(
      writeRequests.map((request) =>
        request.outgoingUpdates.map((update) => update.baselineSegmentCount),
      ),
    ).toEqual([
      [1, undefined],
      [1, undefined],
    ]);
    expect(
      writeRequests.map((request) => request.outgoingUpdates.at(-1)?.id),
    ).toEqual([queuedUpdate.id, queuedUpdate.id]);
    expect(submittedRequests[2]?.outgoingUpdates).toEqual([]);
    expect(rekeyedInputIds).toEqual([queuedUpdate.id]);
    expect(synced?.rekeyedPendingUpdateIds).toEqual([replacementId]);
  } finally {
    close();
  }
});
