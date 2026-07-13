import { expect, test } from "bun:test";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { detachDocumentAttachment } from "./detach";
import { uploadDocumentAttachment } from "./upload";

test("uploadDocumentAttachment gates writes by the verified manifest organization", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const checkedOrganizationIds: string[] = [];
  let bindCount = 0;
  let stageCount = 0;

  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      bindBlobAttachment: async () => {
        bindCount += 1;
        return null;
      },
      getDocumentWriterProjection: async () => writerProjection,
      stageBlob: async () => {
        stageCount += 1;
        return null;
      },
    },
    author,
    bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
    documentId: writerProjection.documentId,
    expectedBindingId: null,
    isRemoteSyncBlocked: (organizationId) => {
      checkedOrganizationIds.push(organizationId);
      return true;
    },
    resolveProjectionUserKey,
    slotId: "blocked-upload",
    targetSecretKey: secretKey,
    writerProjection,
  });

  expect(checkedOrganizationIds).toEqual([author.organizationId]);
  expect(stageCount).toBe(0);
  expect(bindCount).toBe(0);
  expect(uploaded).toBeNull();
});

test("detachDocumentAttachment gates writes by the verified manifest organization", async () => {
  const { author, resolveProjectionUserKey, writerProjection } =
    await createMaterializedSyncFixture();
  const checkedOrganizationIds: string[] = [];
  let submissionCount = 0;

  const detached = await detachDocumentAttachment({
    apiClient: {
      detachBlobAttachment: async () => {
        submissionCount += 1;
        return null;
      },
      getDocumentWriterProjection: async () => writerProjection,
    },
    author,
    bindingId: "550e8400-e29b-41d4-a716-446655440656",
    blobId: "550e8400-e29b-41d4-a716-446655440657",
    documentId: writerProjection.documentId,
    isRemoteSyncBlocked: (organizationId) => {
      checkedOrganizationIds.push(organizationId);
      return true;
    },
    resolveProjectionUserKey,
    slotId: "blocked-detach",
    writerProjection,
  });

  expect(checkedOrganizationIds).toEqual([author.organizationId]);
  expect(submissionCount).toBe(0);
  expect(detached).toBeNull();
});
