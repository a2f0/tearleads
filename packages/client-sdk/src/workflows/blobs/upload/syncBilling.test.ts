import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMultipartBlobStageFixture } from "../../../../test/helpers/data/blobUploadFixtures";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import type { BlobBytes } from "../../../data/blobs/blobContracts";

test.each(["before stage", "during transfer"] as const)(
  "uploadDocumentAttachment checks the organization when blocked %s",
  async (when) => {
    const { author, resolveProjectionUserKey, secretKey, writerProjection } =
      await createMaterializedSyncFixture();
    const checkedOrganizationIds: string[] = [];
    let blocked = when === "before stage";
    let bindCount = 0;
    let stageCount = 0;
    const multipart = createMultipartBlobStageFixture();
    const { close, execSql } = await createTestExecSql("blocked-blob-upload");

    const uploaded = await createBlobAttachmentServiceFixture({
      api: {
        ...multipart,
        bindBlobAttachment: async () => {
          bindCount += 1;
          return null;
        },
        uploadMultipartBlobPartBytes: async (...args) => {
          blocked = true;
          return multipart.uploadMultipartBlobPartBytes(...args);
        },
        getDocumentWriterProjection: async () => writerProjection,
        initiateMultipartBlobStage: async (request) => {
          stageCount += 1;
          return multipart.initiateMultipartBlobStage(request);
        },
      },
      encapsulationSecretKey: secretKey,
      execSql,
    }).uploadDocumentAttachment({
      author,
      bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
      documentId: writerProjection.documentId,
      expectedBindingId: null,
      isRemoteSyncBlocked: (organizationId) => {
        checkedOrganizationIds.push(organizationId);
        return blocked;
      },
      resolveProjectionUserKey,
      slotId: "blocked-upload",
      writerProjection,
    });
    close();

    // The preflight check, then (during transfer) checks before staging, the
    // stage request, the part request, and the bind, all for the manifest's
    // organization.
    expect(checkedOrganizationIds).toEqual(
      Array(when === "before stage" ? 1 : 5).fill(author.organizationId),
    );
    expect(stageCount).toBe(when === "before stage" ? 0 : 1);
    expect(bindCount).toBe(0);
    expect(uploaded).toBeNull();
  },
);

test("detachDocumentAttachment gates writes by the verified manifest organization", async () => {
  const { author, resolveProjectionUserKey, writerProjection } =
    await createMaterializedSyncFixture();
  const checkedOrganizationIds: string[] = [];
  let submissionCount = 0;
  const { close, execSql } = await createTestExecSql("blocked-blob-detach");

  const detached = await createBlobAttachmentServiceFixture({
    api: {
      detachBlobAttachment: async () => {
        submissionCount += 1;
        return null;
      },
      getDocumentWriterProjection: async () => writerProjection,
    },
    execSql,
  }).detachDocumentAttachment({
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
  close();

  expect(checkedOrganizationIds).toEqual([author.organizationId]);
  expect(submissionCount).toBe(0);
  expect(detached).toBeNull();
});
