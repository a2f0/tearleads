import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobBytes } from "../../src/data/blobContracts";
import { attachmentContentSha256 } from "../../src/data/documents/attachmentContentIdentity";
import type { DocumentAttachment } from "../../src/data/documents/documentContent";
import { uploadDocumentAttachment } from "../../src/workflows/blobs/upload";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "./blobUploadFixtures";
import { createMaterializedSyncFixture } from "./documentFixtures";

export function createBlobBytesResponse(input: {
  readonly blobId: string;
  readonly byteLength?: number | undefined;
  readonly encryptedBytes: Uint8Array<ArrayBuffer>;
  readonly onChunk?: (() => void) | undefined;
  readonly sha256: string;
}) {
  const encryptedBytes = input.encryptedBytes.slice();
  const midpoint = Math.ceil(encryptedBytes.byteLength / 2);
  const chunks = [
    encryptedBytes.slice(0, midpoint),
    encryptedBytes.slice(midpoint),
  ].filter((chunk) => chunk.byteLength > 0);
  let nextChunkIndex = 0;

  return {
    blobId: input.blobId,
    byteLength: input.byteLength ?? encryptedBytes.byteLength,
    encryptedBytes: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[nextChunkIndex];
        if (!chunk) {
          controller.close();
          return;
        }

        nextChunkIndex += 1;
        input.onChunk?.();
        controller.enqueue(chunk);
      },
    }),
    sha256: input.sha256,
  };
}

export async function createUploadedAttachmentFixture(input?: {
  bytes?: BlobBytes;
}) {
  const {
    author,
    publicKey,
    resolveProjectionUserKey,
    secretKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440560";
  const bindingId = "550e8400-e29b-41d4-a716-446655440561";
  const slotId = "preview";
  const bytes =
    input?.bytes ??
    (new TextEncoder().encode("remote attachment payload") as BlobBytes);
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const { close, execSql } = await createTestExecSql("attachment-hydration");
  const { getAssembledBytes, ...multipartApi } =
    createMultipartBlobStageFixture();

  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      ...multipartApi,
      bindBlobAttachment: async (_blobId, request) => {
        return createBlobAttachmentBindResponse({
          blobId,
          documentManifest: writerProjection.documentManifest,
          request,
        });
      },
      getDocumentWriterProjection: async () => writerProjection,
    },
    author,
    bindingId,
    blobId,
    bytes,
    contentKey,
    documentId: writerProjection.documentId,
    execSql,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
    targetSecretKey: secretKey,
  });
  const encryptedBytes = getAssembledBytes();
  if (!uploaded || !encryptedBytes) {
    throw new Error("Expected uploaded attachment fixture");
  }
  const stagedBlob = {
    byteLength: uploaded.byteLength,
    encryptedBytes,
    sha256: uploaded.sha256,
  };

  const attachment: DocumentAttachment = {
    contentSha256: await attachmentContentSha256(bytes),
    byteLength: bytes.byteLength,
    mimeType: "text/plain",
    name: "payload.txt",
    slotId,
  };

  return {
    attachment,
    author,
    blobId,
    bindingId,
    bytes,
    contentKey,
    close,
    execSql,
    publicKey,
    resolveProjectionUserKey,
    secretKey,
    stagedBlob,
    uploaded,
    writerProjection,
  };
}

type UploadedAttachmentFixture = Awaited<
  ReturnType<typeof createUploadedAttachmentFixture>
>;
export function createFixtureBinding(fixture: UploadedAttachmentFixture) {
  return {
    bindingEvent: fixture.uploaded.response.bindingEvent,
    bindingId: fixture.bindingId,
    blobId: fixture.blobId,
    blobKekTargets: fixture.uploaded.response.blobKekTargets,
    contentKeyBundle: fixture.uploaded.response.contentKeyBundle,
    documentManifestHash: fixture.uploaded.response.documentManifestHash,
    previousBindingId: fixture.uploaded.response.previousBindingId,
    slotId: fixture.attachment.slotId,
    writeAuthorization: fixture.uploaded.response.writeAuthorization,
    writeHeader: fixture.uploaded.response.writeHeader,
  };
}
