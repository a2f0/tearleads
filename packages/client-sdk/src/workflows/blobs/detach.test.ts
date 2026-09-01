import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { detachDocumentAttachment } from "./detach";

test("detachDocumentAttachment submits a signed detach event", async () => {
  const { author, resolveProjectionUserKey, writerProjection } =
    await createMaterializedSyncFixture();
  const bindingId = "550e8400-e29b-41d4-a716-446655440656";
  const blobId = "550e8400-e29b-41d4-a716-446655440657";
  const slotId = "preview";
  const submittedRequests: BlobAttachmentDetachRequest[] = [];
  const { close, execSql } = await createTestExecSql("attachment-detach");

  const detached = await detachDocumentAttachment({
    apiClient: {
      detachBlobAttachment: async (
        requestBlobId,
        requestBindingId,
        request,
      ) => {
        submittedRequests.push(request);
        return {
          bindingId: requestBindingId,
          blobId: requestBlobId,
          documentId: writerProjection.documentId,
          slotId,
        };
      },
      getDocumentWriterProjection: async () => writerProjection,
    },
    author,
    bindingId,
    blobId,
    documentId: writerProjection.documentId,
    eventId: "550e8400-e29b-41d4-a716-446655440658",
    execSql,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
  });
  close();

  expect(detached?.response).toEqual({
    bindingId,
    blobId,
    documentId: writerProjection.documentId,
    slotId,
  });
  const submittedRequest = submittedRequests[0];
  if (!submittedRequest) {
    throw new Error("Expected submitted detach request.");
  }

  expect(submittedRequest.body).toEqual({
    eventType: "attachment.detach",
    bindingId,
    blobId,
    documentId: writerProjection.documentId,
    slotId,
    documentManifestHash: writerProjection.documentManifest.manifestHash,
  });
  expect(submittedRequest.event).toMatchObject({
    eventId: "550e8400-e29b-41d4-a716-446655440658",
    eventType: "attachment.detach",
    objectKind: "blob",
    objectId: blobId,
    signerUserId: author.signerUserId,
    signedAt: "2026-04-27T00:00:00.000Z",
  });
  expect(submittedRequest.authorizingContainerPathRefs).toHaveLength(1);
  const detachEvent = submittedRequest.event as {
    dependencyManifestHashes: readonly string[];
  };
  expect(detachEvent.dependencyManifestHashes).toContain(
    writerProjection.documentManifest.manifestHash,
  );
});
