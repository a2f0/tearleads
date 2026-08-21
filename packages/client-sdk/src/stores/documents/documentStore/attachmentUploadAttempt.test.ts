import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import { createMultipartBlobStageFixture } from "../../../../test/helpers/blobUploadFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../../data/blobContracts";
import type { SecurityIncidentContext } from "../../../data/securityIncidents";
import { uploadAttachmentWithWriterProjectionRetry } from "./attachmentUploadAttempt";
import type { DocumentStoreState } from "./state";

test("classifies a first upload 402 as a billing pause without a cached projection", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  let remoteSyncBlocked = false;
  let blockCheckCount = 0;
  let stageCount = 0;
  const { close, execSql } = await createTestExecSql("attachment-upload-402");
  const state = {
    runtime: {
      util: {
        isRemoteSyncBlocked: (organizationId: string) => {
          expect(organizationId).toBe(author.organizationId);
          blockCheckCount += 1;
          return remoteSyncBlocked;
        },
      },
    },
    writerProjection: null,
  } as unknown as DocumentStoreState;
  const multipart = createMultipartBlobStageFixture();
  const result = await uploadAttachmentWithWriterProjectionRetry({
    baseUploadInput: {
      apiClient: {
        ...multipart,
        bindBlobAttachment: async () => null,
        getDocumentWriterProjection: async () => writerProjection,
        uploadMultipartBlobPartBytes: async () => {
          stageCount += 1;
          remoteSyncBlocked = true;
          return null;
        },
      },
      author,
      bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
      documentId: writerProjection.documentId,
      execSql,
      expectedBindingId: null,
      resolveProjectionUserKey,
      slotId: "first-upload-402",
      targetSecretKey: secretKey,
    },
    state,
    writerProjection: null,
  });
  close();

  expect(stageCount).toBe(1);
  expect(blockCheckCount).toBe(2);
  expect(result.remoteSyncBlocked).toBe(true);
  expect(result.uploaded).toBeNull();
  expect(result.error).toBeUndefined();
});

test("preserves a billing pause observed before recovery races the postflight check", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  let blockCheckCount = 0;
  let stageCount = 0;
  const { close, execSql } = await createTestExecSql(
    "attachment-upload-preflight-402",
  );
  const state = {
    runtime: {
      util: {
        isRemoteSyncBlocked: () => {
          blockCheckCount += 1;
          return blockCheckCount === 1;
        },
      },
    },
    writerProjection: null,
  } as unknown as DocumentStoreState;
  const multipart = createMultipartBlobStageFixture();

  const result = await uploadAttachmentWithWriterProjectionRetry({
    baseUploadInput: {
      apiClient: {
        ...multipart,
        bindBlobAttachment: async () => null,
        getDocumentWriterProjection: async () => writerProjection,
        initiateMultipartBlobStage: async (request) => {
          stageCount += 1;
          return multipart.initiateMultipartBlobStage(request);
        },
      },
      author,
      bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
      documentId: writerProjection.documentId,
      execSql,
      expectedBindingId: null,
      resolveProjectionUserKey,
      slotId: "preflight-402",
      targetSecretKey: secretKey,
    },
    state,
    writerProjection: null,
  });
  close();

  expect(stageCount).toBe(0);
  expect(blockCheckCount).toBe(1);
  expect(result.remoteSyncBlocked).toBe(true);
  expect(result.uploaded).toBeNull();
  expect(result.error).toBeUndefined();
});

test("does not retry a concrete upload failure with a fresh projection", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const uploadError = new Error("multipart upload network failure");
  let projectionRequests = 0;
  let stageRequests = 0;
  const { close, execSql } = await createTestExecSql(
    "attachment-upload-network-failure",
  );
  const state = {
    runtime: {
      util: { isRemoteSyncBlocked: () => false },
    },
    writerProjection,
  } as unknown as DocumentStoreState;
  const multipart = createMultipartBlobStageFixture();

  try {
    const result = await uploadAttachmentWithWriterProjectionRetry({
      baseUploadInput: {
        apiClient: {
          ...multipart,
          bindBlobAttachment: async () => null,
          getDocumentWriterProjection: async () => {
            projectionRequests += 1;
            return writerProjection;
          },
          uploadMultipartBlobPartBytes: async () => {
            stageRequests += 1;
            throw uploadError;
          },
        },
        author,
        bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
        documentId: writerProjection.documentId,
        execSql,
        expectedBindingId: null,
        resolveProjectionUserKey,
        slotId: "network-failure",
        targetSecretKey: secretKey,
      },
      state,
      writerProjection,
    });

    expect(result.error).toBe(uploadError);
    expect(result.uploaded).toBeNull();
    expect(result.remoteSyncBlocked).toBe(false);
    expect(stageRequests).toBe(1);
    expect(projectionRequests).toBe(0);
    expect(state.writerProjection).toBe(writerProjection);
  } finally {
    close();
  }
});

test("reuses a multipart stage when retrying a null upload result", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  let bindRequests = 0;
  let completeRequests = 0;
  let initiatedRequest:
    | { readonly byteLength: number; readonly sha256: string }
    | undefined;
  let initiateRequests = 0;
  let projectionRequests = 0;
  let uploadedParts = 0;
  const resumedStageIds: string[] = [];
  const resolvedStageIds: string[] = [];
  const { close, execSql } = await createTestExecSql(
    "attachment-upload-stage-retry",
  );
  const state = {
    runtime: {
      util: { isRemoteSyncBlocked: () => false },
    },
    writerProjection,
  } as unknown as DocumentStoreState;

  try {
    const result = await uploadAttachmentWithWriterProjectionRetry({
      baseUploadInput: {
        apiClient: {
          bindBlobAttachment: async () => {
            bindRequests += 1;
            return null;
          },
          completeMultipartBlobStage: async (stageId) => {
            completeRequests += 1;
            if (!initiatedRequest) {
              throw new Error("Expected initiated multipart stage");
            }
            return {
              ...initiatedRequest,
              expiresAt: "2026-04-27T01:00:00.000Z",
              stageId,
            };
          },
          getDocumentWriterProjection: async () => {
            projectionRequests += 1;
            return writerProjection;
          },
          getMultipartBlobStage: async (stageId) => {
            resumedStageIds.push(stageId);
            if (!initiatedRequest) {
              throw new Error("Expected initiated multipart stage");
            }
            return {
              ...initiatedRequest,
              completed: true,
              expiresAt: "2026-04-27T01:00:00.000Z",
              stageId,
              uploadedParts: [],
              uploadId: "upload-reused",
            };
          },
          initiateMultipartBlobStage: async (request) => {
            initiateRequests += 1;
            initiatedRequest = request;
            return {
              ...request,
              expiresAt: "2026-04-27T01:00:00.000Z",
              stageId: "stage-reused",
              uploadedParts: [],
              uploadId: "upload-reused",
            };
          },
          uploadMultipartBlobPartBytes: async (
            stageId,
            partNumber,
            request,
          ) => {
            uploadedParts += 1;
            return {
              part: {
                byteLength: request.byteLength,
                etag: `etag-${partNumber}`,
                partNumber,
              },
              stageId,
              uploadId: request.uploadId,
            };
          },
        },
        author,
        bindingId: "550e8400-e29b-41d4-a716-446655440581",
        blobId: "550e8400-e29b-41d4-a716-446655440580",
        bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
        contentKey: new Uint8Array(32).fill(7),
        documentId: writerProjection.documentId,
        eventId: "550e8400-e29b-41d4-a716-446655440582",
        execSql,
        expectedBindingId: null,
        nonceSeed: new Uint8Array(12).fill(3),
        multipart: { partSize: 5 * 1024 * 1024 },
        onStageResolved: ({ stageId }) => {
          resolvedStageIds.push(stageId);
        },
        resolveProjectionUserKey,
        signedAt: "2026-04-27T00:00:00.000Z",
        slotId: "reused-stage",
        targetSecretKey: secretKey,
      },
      state,
      writerProjection,
    });

    expect(result.error).toBeUndefined();
    expect(result.uploaded).toBeNull();
    expect(initiateRequests).toBe(1);
    expect(uploadedParts).toBe(1);
    expect(completeRequests).toBe(1);
    expect(bindRequests).toBe(2);
    expect(projectionRequests).toBe(1);
    expect(resumedStageIds).toEqual(["stage-reused"]);
    expect(resolvedStageIds).toEqual(["stage-reused", "stage-reused"]);
  } finally {
    close();
  }
});

test("attachment upload propagates identity failures without a projection retry", async () => {
  const { author, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );
  const { close, execSql } = await createTestExecSql(
    "attachment-upload-identity-failure",
  );
  let projectionRequests = 0;
  let stageRequests = 0;
  const incidentContexts: SecurityIncidentContext[] = [];
  const state = {
    localId: writerProjection.documentId,
    runtime: {
      util: {
        isRemoteSyncBlocked: () => false,
        reportSecurityIncident: async (
          error: unknown,
          context: SecurityIncidentContext,
        ) => {
          expect(error).toBe(integrityError);
          incidentContexts.push(context);
        },
      },
    },
    writerProjection,
  } as unknown as DocumentStoreState;
  const multipart = createMultipartBlobStageFixture();

  try {
    await expect(
      uploadAttachmentWithWriterProjectionRetry({
        baseUploadInput: {
          apiClient: {
            ...multipart,
            bindBlobAttachment: async () => null,
            getDocumentWriterProjection: async () => {
              projectionRequests += 1;
              return writerProjection;
            },
            initiateMultipartBlobStage: async (request) => {
              stageRequests += 1;
              return multipart.initiateMultipartBlobStage(request);
            },
          },
          author,
          bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
          documentId: writerProjection.documentId,
          execSql,
          expectedBindingId: null,
          resolveProjectionUserKey: async () => {
            throw integrityError;
          },
          slotId: "identity-failure",
          targetSecretKey: secretKey,
        },
        state,
        writerProjection,
      }),
    ).rejects.toBe(integrityError);
    expect(state.writerProjection).toBe(writerProjection);
    expect(projectionRequests).toBe(0);
    expect(stageRequests).toBe(0);
    expect(incidentContexts).toEqual([
      {
        objectId: writerProjection.documentId,
        objectKind: "document",
        operation: "document.attachment.upload",
      },
    ]);
  } finally {
    close();
  }
});
