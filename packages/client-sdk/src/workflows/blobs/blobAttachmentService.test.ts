import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import { createBlobAttachmentServiceFixture } from "../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../test/helpers/workflows/expiringApiServer";
import { createMaterializedSyncFixture } from "../../../test/helpers/workflows/materializedSyncFixture";
import { BlobAttachmentService } from "./blobAttachmentService";

// A host can call any method of this root-exported class. An upload that
// trusts a caller-supplied source snapshot must stay off it: a snapshot paired
// with other bytes would reuse AES-GCM nonces. Adding a method here is a
// public contract change, like the root export inventory in src/index.test.ts.
test("the public service offers no upload that trusts a source snapshot", () => {
  expect(
    Object.getOwnPropertyNames(BlobAttachmentService.prototype).sort(),
  ).toEqual([
    "constructor",
    "decryptDocumentAttachmentBlob",
    "detachDocumentAttachment",
    "hydrateDocumentAttachmentBlobs",
    "uploadDocumentAttachment",
    "withExpectedDownloads",
  ]);
});

test("detachDocumentAttachment submits a signed detach event", async () => {
  const { author, resolveProjectionUserKey, writerProjection } =
    await createMaterializedSyncFixture();
  const bindingId = "550e8400-e29b-41d4-a716-446655440656";
  const blobId = "550e8400-e29b-41d4-a716-446655440657";
  const slotId = "preview";
  const submittedRequests: BlobAttachmentDetachRequest[] = [];
  const { close, execSql } = await createTestExecSql("attachment-detach");

  const detached = await createBlobAttachmentServiceFixture({
    api: {
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
    execSql,
  }).detachDocumentAttachment({
    author,
    bindingId,
    blobId,
    documentId: writerProjection.documentId,
    documentVersionVector: "document-version-vector",
    eventId: "550e8400-e29b-41d4-a716-446655440658",
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
  expect(submittedRequest.documentVersionVector).toBe(
    "document-version-vector",
  );
  const detachEvent = submittedRequest.event as {
    dependencyManifestHashes: readonly string[];
  };
  expect(detachEvent.dependencyManifestHashes).toContain(
    writerProjection.documentManifest.manifestHash,
  );
});

test.each([
  ["attachment_document_changed", true],
  [undefined, false],
] as const)(
  "a refused detach hands back only a document change (code: %s)",
  async (code, documentChanged) => {
    const { author, resolveProjectionUserKey, writerProjection } =
      await createMaterializedSyncFixture();
    const { close, execSql } = await createTestExecSql(
      "attachment-detach-refused",
    );
    let failure: object | null = null;
    const reported: string[] = [];
    const changed: string[] = [];
    try {
      const detached = await createBlobAttachmentServiceFixture({
        api: {
          detachBlobAttachment: async () => {
            failure = {
              code,
              kind: "http",
              message: "Refused",
              report: () => reported.push("reported"),
              status: 409,
            };
            return null;
          },
          getDocumentWriterProjection: async () => writerProjection,
          getRequestFailure: () => failure as never,
        },
        execSql,
      }).detachDocumentAttachment({
        author,
        bindingId: "550e8400-e29b-41d4-a716-446655440666",
        blobId: "550e8400-e29b-41d4-a716-446655440667",
        documentId: writerProjection.documentId,
        documentVersionVector: "document-version-vector",
        onDocumentChanged: () => changed.push("changed"),
        resolveProjectionUserKey,
        slotId: "preview",
      });
      expect(detached).toBeNull();
    } finally {
      close();
    }
    // Only a refusal for a newer document is routine; anything else is
    // reported as before.
    expect(changed).toEqual(documentChanged ? ["changed"] : []);
    expect(reported).toEqual(documentChanged ? [] : ["reported"]);
  },
);

test.each(SCOPE_RETIREMENTS)(
  "an attachment detach that expires after %s is not renewed or replayed",
  async (change) => {
    const { author, resolveProjectionUserKey, writerProjection } =
      await createMaterializedSyncFixture();
    const bindingId = crypto.randomUUID();
    const blobId = crypto.randomUUID();
    const { close, execSql } = await createTestExecSql(
      `attachment-detach-scope-${change}`,
    );
    const server = createExpiringApiServer({
      method: "POST",
      path: /^\/blobs\/[^/]+\/attachment-bindings\/[^/]+\/detach$/,
    });
    let current = true;
    const changed: string[] = [];
    const reported: string[] = [];
    server.api.setOnError((message) => reported.push(message));
    try {
      const detached = createBlobAttachmentServiceFixture({
        api: {
          detachBlobAttachment: server.api.detachBlobAttachment,
          getDocumentWriterProjection: async () => writerProjection,
          getRequestFailure: (input) => server.api.getRequestFailure(input),
        },
        execSql,
      }).detachDocumentAttachment({
        author,
        bindingId,
        blobId,
        documentId: writerProjection.documentId,
        documentVersionVector: "document-version-vector",
        onDocumentChanged: () => changed.push("changed"),
        resolveProjectionUserKey,
        slotId: "preview",
        stillCurrent: () => current,
      });

      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      // A retired detach leaves its marker for a later pass.
      expect(await detached).toBeNull();
      expect(server.requests).toEqual([
        `POST /blobs/${blobId}/attachment-bindings/${bindingId}/detach`,
      ]);
      expect(server.renewals.count).toBe(0);
      expect(changed).toEqual([]);
      expect(reported).toEqual([]);
    } finally {
      server.stop();
      close();
    }
  },
  15_000,
);
