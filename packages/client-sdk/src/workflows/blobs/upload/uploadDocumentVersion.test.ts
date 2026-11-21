import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../test/helpers/data/blobUploadFixtures";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import type { BlobBytes } from "../../../data/blobs/blobContracts";
import { MAX_DOCUMENT_VERSION_REFRESHES } from "./bindAtDocumentVersion";

// Only its presence on the wire matters here; the API validates the content.
const documentSync = {
  outgoingUpdates: [{ id: "550e8400-e29b-41d4-a716-446655440778" }],
} as unknown as DocumentSyncRequest;

const documentChanged = {
  code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
  kind: "http",
  message: "Document changed after the attachment slot was checked",
  status: 409,
} as const;

/**
 * Uploads with an API that refuses the first `refusals` binds because the
 * document advanced, and a caller whose slot check yields versions in turn.
 */
async function uploadAtDocumentVersions(input: {
  readonly carry?: boolean;
  readonly refusals: number;
  readonly versions: readonly (string | null)[];
}) {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = crypto.randomUUID();
  const multipart = createMultipartBlobStageFixture({
    stageId: `stage-${blobId}`,
  });
  const { getAssembledBytes: _bytes, ...multipartApi } = multipart;
  const binds: BlobAttachmentBindRequest[] = [];
  const checks: boolean[] = [];
  const { close, execSql } = await createTestExecSql(`version-${blobId}`);
  try {
    const uploaded = await createBlobAttachmentServiceFixture({
      api: {
        ...multipartApi,
        bindBlobAttachment: async (requestBlobId, request) => {
          binds.push(request);
          if (binds.length <= input.refusals) return null;
          return createBlobAttachmentBindResponse({
            blobId: requestBlobId,
            documentManifest: writerProjection.documentManifest,
            request,
          });
        },
        getDocumentWriterProjection: async () => writerProjection,
        getRequestFailure: ({ method, path }) =>
          method === "POST" && path === `/blobs/${blobId}/attachment-bindings`
            ? documentChanged
            : null,
      },
      encapsulationSecretKey: secretKey,
      execSql,
    }).uploadDocumentAttachment({
      author,
      blobId,
      bytes: new Uint8Array([4, 5, 6]) as BlobBytes,
      documentId: writerProjection.documentId,
      ...(input.carry ? { documentSync } : {}),
      expectedBindingId: null,
      resolveProjectionUserKey,
      slotId: "preview",
      verifiedDocumentVersion: async ({ refresh }) => {
        checks.push(refresh);
        return input.versions[checks.length - 1] ?? null;
      },
    });
    return { binds, checks, uploaded };
  } finally {
    close();
  }
}

test("a bind refused for a newer document re-checks the slot and binds at the newer version", async () => {
  const { binds, checks, uploaded } = await uploadAtDocumentVersions({
    refusals: 1,
    versions: ["checked", "pulled"],
  });

  expect(checks).toEqual([false, true]);
  expect(binds.map((bind) => bind.documentVersionVector)).toEqual([
    "checked",
    "pulled",
  ]);
  // The same signed bind is retried on the kept stage (the stage fixture
  // refuses a second initiation): only the version changes.
  const [first, second] = binds;
  if (!first || !second) throw new Error("Expected two binds");
  expect({ ...second, documentVersionVector: "checked" }).toEqual(first);
  expect(uploaded?.request.documentVersionVector).toBe("pulled");
});

test("a re-check that finds the slot changed abandons the bind", async () => {
  const { binds, checks, uploaded } = await uploadAtDocumentVersions({
    refusals: 1,
    versions: ["checked", null],
  });

  expect(checks).toEqual([false, true]);
  expect(binds).toHaveLength(1);
  expect(uploaded).toBeNull();
});

test("a document that keeps changing stops the attempt after bounded pulls", async () => {
  const versions = Array.from(
    { length: MAX_DOCUMENT_VERSION_REFRESHES + 5 },
    (_, index) => `version-${index}`,
  );
  const { binds, checks, uploaded } = await uploadAtDocumentVersions({
    refusals: versions.length,
    versions,
  });

  expect(checks).toHaveLength(MAX_DOCUMENT_VERSION_REFRESHES + 1);
  expect(binds).toHaveLength(MAX_DOCUMENT_VERSION_REFRESHES + 1);
  expect(uploaded).toBeNull();
});

test("a bind refused for a newer document keeps the update it carries", async () => {
  const { binds, uploaded } = await uploadAtDocumentVersions({
    carry: true,
    refusals: 1,
    versions: ["checked", "pulled"],
  });

  expect(binds.map((bind) => bind.documentSync)).toEqual([
    documentSync,
    documentSync,
  ]);
  expect(uploaded?.request.documentSync).toEqual(documentSync);
});
