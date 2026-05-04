import type {
  AccessEvent,
  AttachmentBindAccessEventBody,
  WriteHeader,
} from "@tearleads/crypto";
import {
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
} from "@tearleads/crypto";
import type { BlobContentKeyBundleRequest } from "@tearleads/validators/request";
import type { BlobBytes } from "../../../blobs";
import { readCanonicalRecord } from "../../../keyingCanonicalJson";
import { requireProjectionUserKeyResolver } from "../../../keyingProjectionVerification";
import { assertDocumentWriterProjectionConsistent } from "../../actions/linkSet";
import type { ProjectionVerificationOptions } from "../../documentRuntime";
import { uniqueSortedStrings } from "../../shared/readers";
import { projectionVerificationOptions } from "../../shared/types";
import { encryptBlobBytes } from "../shared/crypto";
import {
  signBlobAttachmentEvent,
  signBlobAttachmentWriteHeader,
} from "../shared/events";
import {
  authorizingContainerPathRecords,
  deriveBlobTargetsFromDocumentProjection,
  wrapBlobContentKey,
} from "../shared/projection";
import { readDocumentManifestIdentity } from "../shared/readers";
import { assertBlobAttachmentBindResponse } from "../shared/responses";
import type {
  BlobAttachmentApi,
  BlobAttachmentMaterial,
  UploadDocumentAttachmentInput,
  UploadDocumentAttachmentResult,
} from "../shared/types";

async function buildBlobAttachmentMaterial(
  input: {
    apiClient: BlobAttachmentApi;
    bindingId: string;
    blobId: string;
    bytes: BlobBytes;
    contentKey: Uint8Array;
    contentKeyEpoch: number;
    documentId: string;
    execSql?: import("../../../persistence/sqlSchema").ExecSql | undefined;
    targetSecretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<BlobAttachmentMaterial | null> {
  const writerProjection = await input.apiClient.getDocumentWriterProjection(
    input.documentId,
  );
  if (!writerProjection) {
    return null;
  }

  await assertDocumentWriterProjectionConsistent(writerProjection, {
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

function blobAttachmentStagedBlobRequest(
  stageId: string,
  writeHeader: WriteHeader,
): NonNullable<
  import("@tearleads/validators/request").BlobAttachmentBindRequest["stagedBlob"]
> {
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
}): import("@tearleads/validators/request").BlobAttachmentBindRequest {
  return {
    event: readCanonicalRecord(input.event, "Blob attachment bind event"),
    body: readCanonicalRecord(input.body, "Blob attachment bind body"),
    documentManifest: input.material.writerProjection.documentManifest,
    authorizingContainerPaths: authorizingContainerPathRecords(
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
  author: import("../../shared/types").DocumentCreateAuthor;
  bindingId: string;
  blobId: string;
  contentKeyEpoch: number;
  documentId: string;
  eventId: string;
  expectedBindingId: string | null;
  material: BlobAttachmentMaterial;
  signedAt: string;
  slotId: string;
}): Promise<{
  encryptedBytes: string;
  request: import("@tearleads/validators/request").BlobAttachmentBindRequest;
  response: import("@tearleads/validators/response").BlobAttachmentBindResponse;
  sha256: string;
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
  const TEXT_ENCODER = new TextEncoder();
  const stage = await input.apiClient.stageBlob({
    encryptedBytes: input.material.encrypted.encryptedBytes,
    byteLength: TEXT_ENCODER.encode(input.material.encrypted.encryptedBytes)
      .byteLength,
    sha256: input.material.encrypted.sha256,
  });
  if (!stage) {
    return null;
  }

  const request = blobAttachmentBindRequest({
    body,
    event,
    material: input.material,
    stageId: stage.stageId,
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
    writeHeader,
    writeHeaderHash,
  };
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
  resolveProjectionUserKey,
  signedAt = new Date().toISOString(),
  slotId,
  targetSecretKey,
}: UploadDocumentAttachmentInput): Promise<UploadDocumentAttachmentResult | null> {
  if (contentKey.byteLength !== 32) {
    throw new Error("Blob content key must be 32 bytes");
  }

  const material = await buildBlobAttachmentMaterial({
    apiClient,
    bindingId,
    blobId,
    bytes,
    contentKey,
    contentKeyEpoch,
    documentId,
    execSql,
    resolveProjectionUserKey: requireProjectionUserKeyResolver(
      resolveProjectionUserKey,
      "Document attachment upload",
    ),
    targetSecretKey,
  });
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
    signedAt,
    slotId,
  });
  if (!result) {
    return null;
  }

  return {
    blobId,
    bindingId,
    ...result,
  };
}
