import type {
  AccessEvent,
  AttachmentBindAccessEventBody,
  WriteHeader,
} from "@tearleads/crypto";
import {
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
} from "@tearleads/crypto";
import type {
  BlobAttachmentBindRequest,
  BlobContentKeyBundleRequest,
} from "@tearleads/validators/request";
import type { BlobAttachmentBindResponse } from "@tearleads/validators/response";
import type { BlobBytes } from "../../data/blobContracts";
import { encryptBlobBytes } from "../../data/documents/blob/shared/crypto";
import {
  signBlobAttachmentEvent,
  signBlobAttachmentWriteHeader,
} from "../../data/documents/blob/shared/events";
import {
  deriveBlobTargetsFromDocumentProjection,
  wrapBlobContentKey,
} from "../../data/documents/blob/shared/projection";
import { readDocumentManifestIdentity } from "../../data/documents/blob/shared/readers";
import { assertBlobAttachmentBindResponse } from "../../data/documents/blob/shared/responses";
import type {
  BlobAttachmentApi,
  BlobAttachmentMaterial,
  MultipartStageResolvedListener,
  MultipartUploadProgressListener,
  UploadDocumentAttachmentInput,
  UploadDocumentAttachmentResult,
} from "../../data/documents/blob/shared/types";
import {
  assertDocumentWriterProjectionConsistent,
  authorizingContainerPathRefs,
} from "../../data/documents/shared/projection";
import { uniqueSortedStrings } from "../../data/documents/shared/readers";
import {
  type DocumentCreateAuthor,
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
} from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { resolveMultipartUploadOptions } from "./automaticMultipartUpload";
import { stageMultipartBlobAttachment } from "./multipartUpload";

async function buildBlobAttachmentMaterial(
  input: {
    apiClient: BlobAttachmentApi;
    bindingId: string;
    blobId: string;
    bytes: BlobBytes;
    contentKey: Uint8Array;
    contentKeyEpoch: number;
    documentId: string;
    execSql?: ExecSql | undefined;
    iv?: Uint8Array | undefined;
    targetSecretKey: Uint8Array;
    writerProjection?: UploadDocumentAttachmentInput["writerProjection"];
  } & ProjectionVerificationOptions,
): Promise<BlobAttachmentMaterial | null> {
  const writerProjection =
    input.writerProjection ??
    (await input.apiClient.getDocumentWriterProjection(input.documentId));
  if (!writerProjection) {
    return null;
  }

  await assertDocumentWriterProjectionConsistent(writerProjection, {
    execSql: input.execSql,
    ...projectionVerificationOptions(input),
  });
  const manifestIdentity = readDocumentManifestIdentity(writerProjection);
  if (manifestIdentity.documentId !== input.documentId) {
    throw new Error("Blob attachment writer projection targets wrong document");
  }

  const targets = deriveBlobTargetsFromDocumentProjection({
    bindingId: input.bindingId,
    documentId: input.documentId,
    writerProjection,
  });
  const targetHash = await computeBlobContentKeyTargetHash(targets);
  const contentKeyBundle: BlobContentKeyBundleRequest = {
    contentKeyEpoch: input.contentKeyEpoch,
    targetHash,
    targets: await wrapBlobContentKey({
      contentKey: input.contentKey,
      execSql: input.execSql,
      secretKey: input.targetSecretKey,
      targets,
      writerProjection,
      ...projectionVerificationOptions(input),
    }),
  };
  const encrypted = await encryptBlobBytes({
    blobId: input.blobId,
    bytes: input.bytes,
    contentKey: input.contentKey,
    contentKeyBundle,
    iv: input.iv,
    organizationId: manifestIdentity.organizationId,
  });
  const blobAccessManifestHash = await computeBlobAccessManifestHash({
    version: 1,
    blobId: input.blobId,
    organizationId: manifestIdentity.organizationId,
    activeBindingIds: [input.bindingId],
    documentManifestHashes: [manifestIdentity.manifestHash],
    linkedContainerManifestHashes: uniqueSortedStrings(
      targets.map((target) => target.containerManifestHash),
    ),
    linkedContainerKeyEpochIds: uniqueSortedStrings(
      targets.map((target) => target.containerKeyEpochId),
    ),
    blobKeyTargetHash: targetHash,
  });

  return {
    blobAccessManifestHash,
    contentKeyBundle,
    encrypted,
    manifestIdentity,
    targetHash,
    targets,
    writerProjection,
  };
}

function shouldRetryBlobUploadWithFreshWriterProjection(error: unknown) {
  return (
    error instanceof Error &&
    error.message.startsWith("Container writer projection KEK") &&
    error.message.includes("could not be unwrapped")
  );
}

function blobAttachmentStagedBlobRequest(
  stageId: string,
  writeHeader: WriteHeader,
): NonNullable<BlobAttachmentBindRequest["stagedBlob"]> {
  return {
    stageId,
    writeHeader: readCanonicalRecord(
      writeHeader,
      "Blob attachment write header",
    ),
  };
}

function blobAttachmentBindRequest(input: {
  body: AttachmentBindAccessEventBody;
  event: AccessEvent;
  material: BlobAttachmentMaterial;
  stageId: string;
  writeHeader: WriteHeader;
}): BlobAttachmentBindRequest {
  return {
    event: readCanonicalRecord(input.event, "Blob attachment bind event"),
    body: readCanonicalRecord(input.body, "Blob attachment bind body"),
    authorizingContainerPathRefs: authorizingContainerPathRefs(
      input.material.writerProjection,
    ),
    contentKeyBundle: input.material.contentKeyBundle,
    stagedBlob: blobAttachmentStagedBlobRequest(
      input.stageId,
      input.writeHeader,
    ),
  };
}

async function stageAndBindBlobAttachment(input: {
  apiClient: BlobAttachmentApi;
  author: DocumentCreateAuthor;
  bindingId: string;
  blobId: string;
  contentKeyEpoch: number;
  documentId: string;
  eventId: string;
  expectedBindingId: string | null;
  material: BlobAttachmentMaterial;
  multipart: UploadDocumentAttachmentInput["multipart"];
  onMultipartProgress?: MultipartUploadProgressListener | undefined;
  onStageResolved?: MultipartStageResolvedListener | undefined;
  signedAt: string;
  slotId: string;
}): Promise<{
  encryptedBytes: string;
  request: BlobAttachmentBindRequest;
  response: BlobAttachmentBindResponse;
  sha256: string;
  byteLength: number;
  writeHeader: WriteHeader;
  writeHeaderHash: string;
} | null> {
  const { body, event } = await signBlobAttachmentEvent({
    author: input.author,
    bindingId: input.bindingId,
    blobId: input.blobId,
    documentId: input.documentId,
    eventId: input.eventId,
    expectedBindingId: input.expectedBindingId,
    manifestIdentity: input.material.manifestIdentity,
    signedAt: input.signedAt,
    slotId: input.slotId,
    targets: input.material.targets,
  });
  const { writeHeader, writeHeaderHash } = await signBlobAttachmentWriteHeader({
    author: input.author,
    blobAccessManifestHash: input.material.blobAccessManifestHash,
    blobId: input.blobId,
    contentKeyEpoch: input.contentKeyEpoch,
    encrypted: input.material.encrypted,
    manifestIdentity: input.material.manifestIdentity,
    signedAt: input.signedAt,
    targetHash: input.material.targetHash,
  });
  const multipart = await resolveMultipartUploadOptions({
    apiClient: input.apiClient,
    encryptedByteLength: input.material.encrypted.byteLength,
    multipart: input.multipart,
  });
  const stageId = multipart
    ? await stageMultipartBlobAttachment({
        apiClient: input.apiClient,
        encryptedBytes: input.material.encrypted.encryptedBytes,
        multipart,
        byteLength: input.material.encrypted.byteLength,
        onMultipartProgress: input.onMultipartProgress,
        onStageResolved: input.onStageResolved,
        sha256: input.material.encrypted.sha256,
      })
    : await stageLegacyBlobAttachment({
        apiClient: input.apiClient,
        encryptedBytes: input.material.encrypted.encryptedBytes,
        byteLength: input.material.encrypted.byteLength,
        sha256: input.material.encrypted.sha256,
      });
  if (!stageId) {
    return null;
  }

  const request = blobAttachmentBindRequest({
    body,
    event,
    material: input.material,
    stageId,
    writeHeader,
  });
  const response = await input.apiClient.bindBlobAttachment(
    input.blobId,
    request,
  );
  if (!response) {
    return null;
  }

  await assertBlobAttachmentBindResponse({
    bindingId: input.bindingId,
    blobAccessManifestHash: input.material.blobAccessManifestHash,
    blobId: input.blobId,
    contentKeyBundle: input.material.contentKeyBundle,
    documentId: input.documentId,
    manifestIdentity: input.material.manifestIdentity,
    response,
    slotId: input.slotId,
    targetHash: input.material.targetHash,
    targets: input.material.targets,
    writeHeaderHash,
  });

  return {
    encryptedBytes: input.material.encrypted.encryptedBytes,
    request,
    response,
    sha256: input.material.encrypted.sha256,
    byteLength: input.material.encrypted.byteLength,
    writeHeader,
    writeHeaderHash,
  };
}

async function stageLegacyBlobAttachment(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly byteLength: number;
  readonly encryptedBytes: string;
  readonly sha256: string;
}): Promise<string | null> {
  const stage = await input.apiClient.stageBlob({
    encryptedBytes: input.encryptedBytes,
    byteLength: input.byteLength,
    sha256: input.sha256,
  });

  return stage?.stageId ?? null;
}

export async function uploadDocumentAttachment({
  apiClient,
  author,
  blobId = crypto.randomUUID(),
  bindingId = crypto.randomUUID(),
  bytes,
  contentKey = crypto.getRandomValues(new Uint8Array(32)),
  contentKeyEpoch = 1,
  documentId,
  eventId = crypto.randomUUID(),
  execSql,
  expectedBindingId,
  iv,
  multipart,
  onMultipartProgress,
  onStageResolved,
  resolveProjectionUserKey,
  signedAt = new Date().toISOString(),
  slotId,
  targetSecretKey,
  warmReferencedPrincipalPolicies,
  writerProjection,
}: UploadDocumentAttachmentInput): Promise<UploadDocumentAttachmentResult | null> {
  if (contentKey.byteLength !== 32) {
    throw new Error("Blob content key must be 32 bytes");
  }
  const resolveProjectionUserKeyForUpload = requireProjectionUserKeyResolver(
    resolveProjectionUserKey,
    "Document attachment upload",
  );

  const buildMaterial = (
    freshWriterProjection: UploadDocumentAttachmentInput["writerProjection"],
  ) =>
    buildBlobAttachmentMaterial({
      apiClient,
      bindingId,
      blobId,
      bytes,
      contentKey,
      contentKeyEpoch,
      documentId,
      execSql,
      iv,
      resolveProjectionUserKey: resolveProjectionUserKeyForUpload,
      targetSecretKey,
      warmReferencedPrincipalPolicies,
      writerProjection: freshWriterProjection,
    });
  let material: BlobAttachmentMaterial | null;
  try {
    material = await buildMaterial(writerProjection);
  } catch (error) {
    if (
      !apiClient.evictDocumentWriterProjection ||
      !shouldRetryBlobUploadWithFreshWriterProjection(error)
    ) {
      throw error;
    }

    // The attachment binds to this document; only its projection was stale, so
    // evict just it rather than wiping the whole projection cache.
    apiClient.evictDocumentWriterProjection(documentId);
    material = await buildMaterial(undefined);
  }
  if (!material) {
    return null;
  }

  const result = await stageAndBindBlobAttachment({
    apiClient,
    author,
    bindingId,
    blobId,
    contentKeyEpoch,
    documentId,
    eventId,
    expectedBindingId,
    material,
    multipart,
    onMultipartProgress,
    onStageResolved,
    signedAt,
    slotId,
  });
  if (!result) {
    return null;
  }

  return {
    blobId,
    bindingId,
    writerProjection: material.writerProjection,
    ...result,
  };
}
