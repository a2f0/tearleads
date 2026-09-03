import { expect, test } from "bun:test";
import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  type ContainerGrantPrincipalHead,
  type ReferencedPrincipalHead,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../test/helpers/blobUploadFixtures";
import {
  createContainerManifestFixture,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  substituteFirstProjectionUserWrapMaterial,
} from "../../../test/helpers/containerFixtures";
import {
  createMaterializedSyncFixture,
  createResponse,
} from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { parseBlobEncryptedBytes } from "../../data/documents/blob/shared/readers";
import { ensurePrincipalPolicyTables } from "../../data/persistence/principalPolicyPersistence";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";
import { uploadDocumentAttachment } from "./upload";

const MIN_MULTIPART_CHUNK_SIZE = 5 * 1024 * 1024;

test("uploadDocumentAttachment wraps blob keys with the blob content-key suite", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440555";
  const bindingId = "550e8400-e29b-41d4-a716-446655440556";
  const slotId = "preview";
  const submittedResponses: {
    readonly contentKeyBundle: {
      readonly targets: readonly { readonly wrappingMetadata: unknown }[];
    };
  }[] = [];
  let requestedOrganizationId: string | undefined;
  const multipart = createMultipartBlobStageFixture({
    stageId: "stage-blob-suite",
  });
  const { getAssembledBytes, ...multipartApi } = multipart;
  const { close, execSql } = await createTestExecSql("blob-key-wrap-suite");

  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      ...multipartApi,
      bindBlobAttachment: async (requestBlobId, request, options) => {
        requestedOrganizationId =
          options?.expectedPaymentRequiredOrganizationId;
        const response = await createBlobAttachmentBindResponse({
          blobId: requestBlobId,
          documentManifest: writerProjection.documentManifest,
          request,
        });
        submittedResponses.push(response);
        return response;
      },
      getDocumentWriterProjection: async () => writerProjection,
    },
    author,
    bindingId,
    blobId,
    bytes: new Uint8Array([1, 2, 3, 4]) as BlobBytes,
    documentId: writerProjection.documentId,
    execSql,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
    targetSecretKey: secretKey,
  });
  close();

  expect(uploaded?.blobId).toBe(blobId);
  expect(uploaded?.writerProjection).toBe(writerProjection);
  expect(requestedOrganizationId).toBe(author.organizationId);
  const stagedBytes = getAssembledBytes();
  if (!stagedBytes) {
    throw new Error("Expected staged encrypted blob bytes.");
  }
  const stagedEncryptedRecord = parseBlobEncryptedBytes(stagedBytes);
  expect(stagedEncryptedRecord.blobId).toBe(blobId);
  expect(stagedEncryptedRecord.byteLength).toBe(4);
  expect(stagedEncryptedRecord).not.toHaveProperty("contentKeyBundle");
  expect(stagedEncryptedRecord).not.toHaveProperty("targetHash");
  expect(submittedResponses[0]?.contentKeyBundle.targets).toEqual([
    expect.objectContaining({
      wrappingMetadata: expect.objectContaining({
        suite: BLOB_CONTENT_KEY_WRAP_SUITE,
      }),
    }),
  ]);
});

test("uploadDocumentAttachment stages binary v2 with multipart uploads", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440565";
  const bindingId = "550e8400-e29b-41d4-a716-446655440566";
  const slotId = "preview";
  const multipart = createMultipartBlobStageFixture({
    stageId: "stage-multipart-upload",
    uploadId: "upload-multipart-upload",
  });
  const uploadedPartNumbers: number[] = [];
  const completedPartNumbers: number[] = [];
  const { close, execSql } = await createTestExecSql("multipart-blob-upload");

  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      completeMultipartBlobStage: async (stageId, request) => {
        completedPartNumbers.push(
          ...request.parts.map((part) => part.partNumber),
        );
        return multipart.completeMultipartBlobStage(stageId, request);
      },
      getDocumentWriterProjection: async () => writerProjection,
      getMultipartBlobStage: multipart.getMultipartBlobStage,
      initiateMultipartBlobStage: multipart.initiateMultipartBlobStage,
      bindBlobAttachment: async (requestBlobId, request) =>
        createBlobAttachmentBindResponse({
          blobId: requestBlobId,
          documentManifest: writerProjection.documentManifest,
          request,
        }),
      uploadMultipartBlobPartBytes: async (stageId, partNumber, request) => {
        const response = await multipart.uploadMultipartBlobPartBytes(
          stageId,
          partNumber,
          request,
        );
        uploadedPartNumbers.push(partNumber);
        return response;
      },
    },
    author,
    bindingId,
    blobId,
    bytes: new Uint8Array(MIN_MULTIPART_CHUNK_SIZE + 128) as BlobBytes,
    documentId: writerProjection.documentId,
    execSql,
    expectedBindingId: null,
    multipart: { partSize: MIN_MULTIPART_CHUNK_SIZE },
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
    targetSecretKey: secretKey,
  });
  close();

  expect(uploaded?.blobId).toBe(blobId);
  expect(uploaded?.request.stagedBlob?.stageId).toBe("stage-multipart-upload");
  const encryptedBytes = multipart.getAssembledBytes();
  if (!encryptedBytes) {
    throw new Error("Expected assembled binary blob bytes");
  }
  const encryptedRecord = parseBlobEncryptedBytes(encryptedBytes);
  expect(encryptedRecord).toMatchObject({
    blobId,
    byteLength: MIN_MULTIPART_CHUNK_SIZE + 128,
    chunkCount: 2,
    chunkSize: MIN_MULTIPART_CHUNK_SIZE,
  });
  expect(encryptedRecord).not.toHaveProperty("contentKeyBundle");
  expect(encryptedRecord).not.toHaveProperty("targetHash");
  expect(uploadedPartNumbers.toSorted()).toEqual([1, 2]);
  expect(completedPartNumbers.toSorted()).toEqual([1, 2]);
});

test("uploadDocumentAttachment warms managed policies for the projection owner before staging", async () => {
  const {
    author,
    projection,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const projectionKek = projection.containerKeks[0];
  if (!projectionKek) {
    throw new Error("Expected projection KEK fixture");
  }
  const groupHead: ContainerGrantPrincipalHead = {
    keyEpoch: 1,
    keyFingerprint: await toFingerprint(
      new TextEncoder().encode("attachment-upload-group-key"),
    ),
    principalId: "attachment-upload-group",
    principalType: "group",
    stateHash: await toFingerprint(
      new TextEncoder().encode("attachment-upload-group-state"),
    ),
    version: 1,
  };
  const managedManifest = await createContainerManifestFixture({
    author,
    containerId: projection.containerId,
    containerKeyEpochId: projectionKek.containerKeyEpochId,
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: author.signerUserId,
        subjectType: "user",
      },
      {
        accessLevel: "write",
        subjectId: groupHead.principalId,
        subjectType: "group",
      },
    ],
    eventId: "event-attachment-upload-managed-policy",
    metadataDocumentId: "metadata-attachment-upload-managed-policy",
    organizationId: projection.organizationId,
    referencedPrincipalHeads: [groupHead],
    signingPublicKey,
  });
  const managedWriterProjection: DocumentWriterProjectionResponse = {
    ...writerProjection,
    authorizingContainerPaths: [
      {
        ...projection,
        path: [managedManifest as unknown as (typeof projection.path)[number]],
      },
    ],
  };
  const requests: Array<{
    organizationId: string;
    references: readonly ReferencedPrincipalHead[];
  }> = [];
  const { close, execSql } = await createTestExecSql(
    "attachment-upload-policy-warmer",
  );
  try {
    await ensurePrincipalPolicyTables(execSql);
    await expect(
      uploadDocumentAttachment({
        apiClient: {
          ...createMultipartBlobStageFixture(),
          bindBlobAttachment: async () => {
            throw new Error("Unexpected bind");
          },
          getDocumentWriterProjection: async () => managedWriterProjection,
        },
        author,
        blobId: "550e8400-e29b-41d4-a716-446655440567",
        bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
        documentId: writerProjection.documentId,
        execSql,
        expectedBindingId: null,
        resolveProjectionUserKey,
        slotId: "preview",
        targetSecretKey: secretKey,
        warmReferencedPrincipalPolicies: async (request) => {
          requests.push(request);
          throw new Error("Attachment upload policy warmer reached");
        },
        writerProjection: managedWriterProjection,
      }),
    ).rejects.toThrow("Attachment upload policy warmer reached");
    expect(requests).toEqual([
      {
        organizationId: projection.organizationId,
        references: [groupHead],
      },
    ]);
  } finally {
    close();
  }
});

test("uploadDocumentAttachment rejects substituted KEK material before staging", async () => {
  const parent = await createParentProjection();
  const resolveProjectionUserKey =
    createParentProjectionUserKeyResolver(parent);
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: parent.projection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440112",
    eventId: "event-substituted-kek-blob",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: parent.secretKey,
    trustedLocalProjection: true,
  });
  const response = createResponse(materializedCreate.plan);
  const tamperedProjection = await substituteFirstProjectionUserWrapMaterial({
    projection: parent.projection,
    publicKey: parent.encapsulationPublicKey,
    userId: parent.userId,
  });
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [tamperedProjection],
    contentKeyBundle: response.contentKeyBundle,
    documentContainerManifestHistory: [
      ...tamperedProjection.path,
      ...tamperedProjection.containerKeks.flatMap(
        (kek) => kek.containerManifestHistory,
      ),
    ],
    documentId: response.id,
    documentKekTargets: response.documentKekTargets,
    documentManifest: response.accessManifest,
    documentManifestContainerPaths: [[...tamperedProjection.path]],
    documentManifestHistory: [],
  };
  let stageCalled = false;
  let bindCalled = false;
  const multipart = createMultipartBlobStageFixture();
  const { close, execSql } = await createTestExecSql("substituted-blob-kek");

  await expect(
    uploadDocumentAttachment({
      apiClient: {
        ...multipart,
        bindBlobAttachment: async () => {
          bindCalled = true;
          throw new Error("Unexpected bind");
        },
        getDocumentWriterProjection: async () => writerProjection,
        initiateMultipartBlobStage: async (request) => {
          stageCalled = true;
          return multipart.initiateMultipartBlobStage(request);
        },
      },
      author: parent.author,
      blobId: "550e8400-e29b-41d4-a716-446655440113",
      bytes: new Uint8Array([8, 9, 10]) as BlobBytes,
      documentId: writerProjection.documentId,
      execSql,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:00.000Z",
      slotId: "preview",
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow("KEK material does not match committed epoch id");
  close();
  expect(stageCalled).toBe(false);
  expect(bindCalled).toBe(false);
});
