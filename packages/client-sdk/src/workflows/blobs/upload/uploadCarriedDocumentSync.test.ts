import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../test/helpers/blobUploadFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../../data/blobs/blobContracts";
import { uploadDocumentAttachment } from "./index";

// Only its presence on the wire matters here; the API validates the content.
const documentSync = {
  outgoingUpdates: [{ id: "550e8400-e29b-41d4-a716-446655440777" }],
} as unknown as DocumentSyncRequest;

async function uploadWithCarriedSync(input: {
  readonly failFirstBindWith: {
    kind: "http" | "network";
    status: number | null;
  } | null;
}) {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = crypto.randomUUID();
  const multipart = createMultipartBlobStageFixture({
    stageId: `stage-${blobId}`,
  });
  const { getAssembledBytes: _bytes, ...multipartApi } = multipart;
  const binds: BlobAttachmentBindRequest[] = [];
  const { close, execSql } = await createTestExecSql(`carried-${blobId}`);
  try {
    const uploaded = await uploadDocumentAttachment({
      apiClient: {
        ...multipartApi,
        bindBlobAttachment: async (requestBlobId, request) => {
          binds.push(request);
          if (binds.length === 1 && input.failFirstBindWith) return null;
          return createBlobAttachmentBindResponse({
            blobId: requestBlobId,
            documentManifest: writerProjection.documentManifest,
            request,
          });
        },
        getDocumentWriterProjection: async () => writerProjection,
        getRequestFailure: ({ method, path }) =>
          input.failFirstBindWith &&
          method === "POST" &&
          path === `/blobs/${blobId}/attachment-bindings`
            ? { ...input.failFirstBindWith, message: "refused" }
            : null,
      },
      author,
      blobId,
      bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
      documentId: writerProjection.documentId,
      documentSync,
      execSql,
      expectedBindingId: null,
      resolveProjectionUserKey,
      slotId: "preview",
      targetSecretKey: secretKey,
    });
    return { binds, uploaded };
  } finally {
    close();
  }
}

test("the bind carries the document's deferred first update", async () => {
  const { binds, uploaded } = await uploadWithCarriedSync({
    failFirstBindWith: null,
  });
  expect(binds.map((bind) => bind.documentSync)).toEqual([documentSync]);
  expect(uploaded?.request.documentSync).toEqual(documentSync);
});

test("a bind refused with the carried update binds once more without it", async () => {
  const { binds, uploaded } = await uploadWithCarriedSync({
    failFirstBindWith: { kind: "http", status: 409 },
  });
  expect(binds.map((bind) => bind.documentSync)).toEqual([
    documentSync,
    undefined,
  ]);
  expect(uploaded?.request.documentSync).toBeUndefined();
});

for (const failure of [
  { kind: "http", status: 402 },
  { kind: "http", status: 503 },
  { kind: "network", status: null },
] as const) {
  test(`a ${failure.status ?? failure.kind} bind failure is not retried without the update`, async () => {
    const { binds, uploaded } = await uploadWithCarriedSync({
      failFirstBindWith: failure,
    });
    expect(binds).toHaveLength(1);
    expect(uploaded).toBeNull();
  });
}
