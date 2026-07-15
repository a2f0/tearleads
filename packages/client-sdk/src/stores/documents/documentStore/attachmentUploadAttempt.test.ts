import { expect, test } from "bun:test";
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
