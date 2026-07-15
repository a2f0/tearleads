import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../../data/blobContracts";
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

  const result = await uploadAttachmentWithWriterProjectionRetry({
    baseUploadInput: {
      apiClient: {
        bindBlobAttachment: async () => null,
        getDocumentWriterProjection: async () => writerProjection,
        stageBlob: async () => {
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

  const result = await uploadAttachmentWithWriterProjectionRetry({
    baseUploadInput: {
      apiClient: {
        bindBlobAttachment: async () => null,
        getDocumentWriterProjection: async () => writerProjection,
        stageBlob: async () => {
          stageCount += 1;
          return null;
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
  const state = {
    runtime: {
      util: { isRemoteSyncBlocked: () => false },
    },
    writerProjection,
  } as unknown as DocumentStoreState;

  try {
    await expect(
      uploadAttachmentWithWriterProjectionRetry({
        baseUploadInput: {
          apiClient: {
            bindBlobAttachment: async () => null,
            getDocumentWriterProjection: async () => {
              projectionRequests += 1;
              return writerProjection;
            },
            stageBlob: async () => {
              stageRequests += 1;
              return null;
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
  } finally {
    close();
  }
});
