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
import {
  type BlobByteSource,
  createBlobByteSource,
} from "../../data/blobContracts";
import type { BlobSourceSnapshot } from "../../data/documents/blob/shared/blobSourceSnapshot";
import { prepareBlobEncryption } from "../../data/documents/blob/shared/crypto";
import {
  signBlobAttachmentEvent,
  signBlobAttachmentWriteHeader,
} from "../../data/documents/blob/shared/events";
import {
  verifiedBlobWrapTargetsFromDocumentProjection,
  wrapBlobContentKey,
} from "../../data/documents/blob/shared/projection";
import { assertBlobAttachmentBindResponse } from "../../data/documents/blob/shared/responses";
import type {
  BlobAttachmentApi,
  BlobAttachmentMaterial,
  MultipartStageResolvedListener,
  MultipartUploadProgressListener,
  UploadDocumentAttachmentInput,
  UploadDocumentAttachmentResult,
} from "../../data/documents/blob/shared/types";
import { authorizingContainerPathRefs } from "../../data/documents/shared/projection";
import { uniqueSortedStrings } from "../../data/documents/shared/readers";
import {
  type DocumentCreateAuthor,
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
} from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { shouldRetryWithFreshProjection } from "../documents/syncFailureClassification";
import { resolveMultipartUploadOptions } from "./automaticMultipartUpload";
import { stageMultipartBlobAttachment } from "./multipartUpload";
import { resolveBlobMutationWriterProjection } from "./writerProjection";

async function buildBlobAttachmentMaterial(
  input: {
    apiClient: BlobAttachmentApi;
    bindingId: string;
    blobId: string;
    contentKey: Uint8Array;
    contentKeyEpoch: number;
    documentId: string;
    execSql?: ExecSql | undefined;
    isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
    nonceSeed?: Uint8Array | undefined;
    partSize: number;
    source: BlobByteSource;
    sourceSnapshot?: BlobSourceSnapshot | undefined;
    targetSecretKey: Uint8Array;
    writerProjection?: UploadDocumentAttachmentInput["writerProjection"];
  } & ProjectionVerificationOptions,
): Promise<BlobAttachmentMaterial | null> {
  const resolved = await resolveBlobMutationWriterProjection({
    apiClient: input.apiClient,
    documentId: input.documentId,
    errorLabel: "Blob attachment",
    execSql: input.execSql,
    isRemoteSyncBlocked: input.isRemoteSyncBlocked,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });
  if (!resolved) {
    return null;
  }
  const { manifestIdentity, writerProjection } = resolved;

  const targets = verifiedBlobWrapTargetsFromDocumentProjection({
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
  const encrypted = await prepareBlobEncryption({
    blobId: input.blobId,
    chunkSize: input.partSize,
    contentKey: input.contentKey,
    contentKeyBundle,
    nonceSeed: input.nonceSeed,
    organizationId: manifestIdentity.organizationId,
    source: input.source,
    sourceSnapshot: input.sourceSnapshot,
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
    stagedBlob: {
      stageId: input.stageId,
      writeHeader: readCanonicalRecord(
        input.writeHeader,
        "Blob attachment write header",
      ),
    },
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
  multipart: NonNullable<UploadDocumentAttachmentInput["multipart"]>;
  onMultipartProgress?: MultipartUploadProgressListener | undefined;
  onStageResolved?: MultipartStageResolvedListener | undefined;
  onStageUnavailable?: ((stageId: string) => Promise<void>) | undefined;
  signedAt: string;
  slotId: string;
}): Promise<{
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
    authorizingContainerPathRefs: authorizingContainerPathRefs(
      input.material.writerProjection,
    ),
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
  const stageId = await stageMultipartBlobAttachment({
    apiClient: input.apiClient,
    encryption: input.material.encrypted,
    multipart: input.multipart,
    onMultipartProgress: input.onMultipartProgress,
    onStageResolved: input.onStageResolved,
    onStageUnavailable: input.onStageUnavailable,
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
    {
      expectedPaymentRequiredOrganizationId:
        input.material.manifestIdentity.organizationId,
    },
  );
  if (!response) {
    return null;
  }

  await assertBlobAttachmentBindResponse({
    body,
    bindingId: input.bindingId,
    blobAccessManifestHash: input.material.blobAccessManifestHash,
    blobId: input.blobId,
    contentKeyBundle: input.material.contentKeyBundle,
    documentId: input.documentId,
    event,
    manifestIdentity: input.material.manifestIdentity,
    response,
    slotId: input.slotId,
    targetHash: input.material.targetHash,
    targets: input.material.targets,
    writeHeader,
    writeHeaderHash,
  });

  return {
    request,
    response,
    sha256: input.material.encrypted.sha256,
    byteLength: input.material.encrypted.byteLength,
    writeHeader,
    writeHeaderHash,
  };
}

interface PreparedUploadDocumentAttachmentInput
  extends UploadDocumentAttachmentInput {
  readonly sourceSnapshot?: BlobSourceSnapshot | undefined;
  readonly onStageUnavailable?:
    | ((stageId: string) => Promise<void>)
    | undefined;
}

async function uploadDocumentAttachmentImpl({
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
  isRemoteSyncBlocked,
  nonceSeed,
  multipart,
  onMultipartProgress,
  onStageResolved,
  onStageUnavailable,
  resolveProjectionUserKey,
  signedAt = new Date().toISOString(),
  slotId,
  sourceSnapshot,
  targetSecretKey,
  warmReferencedPrincipalPolicies,
  writerProjection,
}: PreparedUploadDocumentAttachmentInput): Promise<UploadDocumentAttachmentResult | null> {
  if (contentKey.byteLength !== 32) {
    throw new Error("Blob content key must be 32 bytes");
  }
  const resolveProjectionUserKeyForUpload = requireProjectionUserKeyResolver(
    resolveProjectionUserKey,
    "Document attachment upload",
  );
  const resolvedMultipart = resolveMultipartUploadOptions(multipart);
  const source = createBlobByteSource(bytes);

  const buildMaterial = (
    freshWriterProjection: UploadDocumentAttachmentInput["writerProjection"],
  ) =>
    buildBlobAttachmentMaterial({
      apiClient,
      bindingId,
      blobId,
      contentKey,
      contentKeyEpoch,
      documentId,
      execSql,
      isRemoteSyncBlocked,
      nonceSeed,
      partSize: resolvedMultipart.partSize,
      resolveProjectionUserKey: resolveProjectionUserKeyForUpload,
      source,
      sourceSnapshot,
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
      !shouldRetryWithFreshProjection(
        error,
        (message) =>
          message.startsWith("Container writer projection KEK") &&
          message.includes("could not be unwrapped"),
      )
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
    multipart: resolvedMultipart,
    onMultipartProgress,
    onStageResolved,
    onStageUnavailable,
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

export function uploadDocumentAttachment(
  input: UploadDocumentAttachmentInput,
): Promise<UploadDocumentAttachmentResult | null> {
  return uploadDocumentAttachmentImpl({ ...input, sourceSnapshot: undefined });
}

/** Internal upload path for a source snapshot produced by `inspectBlobSource`. */
export function uploadPreparedDocumentAttachment(
  input: PreparedUploadDocumentAttachmentInput,
): Promise<UploadDocumentAttachmentResult | null> {
  return uploadDocumentAttachmentImpl(input);
}
