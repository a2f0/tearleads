import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { MULTIPART_BLOB_STAGE_ERROR_CODES } from "@tearleads/validators/response";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../test/helpers/blobUploadFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import type { PendingAttachmentRecord } from "../../../workflows/documents";
import { uploadAttachmentWithWriterProjectionRetry } from "./attachmentUploadAttempt";
import { resolveAttachmentUploadResume } from "./attachmentUploadResume";
import type { DocumentAttachmentBinding, DocumentStoreState } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

test("a consumed stage whose committed binding was removed renews the durable upload", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "consumed-attachment-stage",
  );
  const saved: PendingAttachmentRecord[] = [];
  const boundBlobIds: string[] = [];
  let bindings: DocumentAttachmentBinding[] | null = null;
  const multipart = createMultipartBlobStageFixture();
  const apiClient = {
    ...multipart,
    getMultipartBlobStage: async () => null,
    getRequestFailure: () => ({
      code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
      kind: "http" as const,
      message: "stage consumed by the original bind",
      status: 404,
    }),
    getDocumentWriterProjection: async () => fixture.writerProjection,
    listDocumentAttachments: async () => bindings,
    bindBlobAttachment: async (
      blobId: string,
      request: Parameters<
        typeof createBlobAttachmentBindResponse
      >[0]["request"],
    ) => {
      boundBlobIds.push(blobId);
      return createBlobAttachmentBindResponse({
        blobId,
        documentManifest: fixture.writerProjection.documentManifest,
        request,
      });
    },
  };
  const state = {
    doc: null,
    localId: "local-document",
    persistence: {
      savePendingAttachment: async (
        _execSql: unknown,
        record: PendingAttachmentRecord,
      ) => {
        saved.push(structuredClone(record));
      },
    },
    runtime: {
      apiClient,
      infra: { execSql },
      state: { domainScope: {} },
      util: { reportSecurityIncident: async () => {} },
    },
    writerProjection: fixture.writerProjection,
  } as unknown as DocumentStoreState;
  const generation = captureDocumentStoreSyncGeneration(state, null);
  if (!generation) throw new Error("Expected live attachment generation");
  const pending: PendingAttachmentRecord = {
    byteLength: 3,
    localId: state.localId,
    mimeType: "application/octet-stream",
    name: "pending.bin",
    slotId: "slot-1",
    storageKey: "pending-bytes",
  };
  try {
    const original = await resolveAttachmentUploadResume(
      state,
      pending,
      "a".repeat(64),
      generation,
    );
    await original.onStageResolved({
      partSize: 5 * 1024 * 1024,
      stageId: "consumed-stage",
    });
    const resume = await resolveAttachmentUploadResume(
      state,
      pending,
      "a".repeat(64),
      generation,
    );
    const attempt = (upload: typeof resume) =>
      uploadAttachmentWithWriterProjectionRetry({
        baseUploadInput: {
          apiClient,
          author: fixture.author,
          blobId: upload.blobId,
          bytes: new Uint8Array([1, 2, 3]),
          contentKey: upload.contentKey,
          documentId: fixture.writerProjection.documentId,
          execSql,
          expectedBindingId: null,
          multipart: upload.multipart,
          nonceSeed: upload.nonceSeed,
          onStageResolved: upload.onStageResolved,
          onStageUnavailable: (stageId) =>
            upload.onStageUnavailable(
              stageId,
              fixture.writerProjection.documentId,
            ),
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
          slotId: pending.slotId,
          targetSecretKey: fixture.secretKey,
        },
        state,
        writerProjection: fixture.writerProjection,
      });

    // Failure of the additional recovery read must retain the original identity.
    expect((await attempt(resume)).error).toMatchObject({
      message: "Attachment recovery lookup failed.",
    });
    expect(pending.upload?.blobId).toBe(original.blobId);

    // A lost response with the original binding still active belongs to normal
    // adoption, even on the immediate retry within the same document pass.
    bindings = [
      { blobId: original.blobId, slotId: pending.slotId },
    ] as DocumentAttachmentBinding[];
    expect((await attempt(resume)).uploaded).toBeNull();
    expect(pending.upload?.blobId).toBe(original.blobId);

    // Another client removed the binding after commit. Its blob id remains
    // reserved server-side, so replacing only the stage can never succeed.
    bindings = [];
    expect((await attempt(resume)).uploaded).toBeNull();
    expect(saved.at(-1)?.upload?.blobId).not.toBe(original.blobId);
    expect(saved.at(-1)?.upload?.stageId).toBeNull();
    expect(boundBlobIds).toEqual([]);
    const restartedPending = structuredClone(saved.at(-1));
    if (!restartedPending) throw new Error("Expected durable retry state");
    const renewed = await resolveAttachmentUploadResume(
      state,
      restartedPending,
      "a".repeat(64),
      generation,
    );
    expect(renewed.blobId).not.toBe(original.blobId);
    expect(restartedPending.upload?.blobId).toBe(renewed.blobId);
    expect(renewed.contentKey).not.toEqual(original.contentKey);
    expect(renewed.nonceSeed).not.toEqual(original.nonceSeed);
    expect(saved.at(-1)?.upload?.blobId).toBe(renewed.blobId);
    expect((await attempt(renewed)).uploaded?.blobId).toBe(renewed.blobId);
    expect(boundBlobIds).toEqual([renewed.blobId]);
  } finally {
    close();
  }
});
