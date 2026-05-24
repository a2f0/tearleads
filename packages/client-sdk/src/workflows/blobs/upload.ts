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
import type {
  BlobAttachmentBindResponse,
  MultipartBlobStagePart,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../../data/blobContracts";
import { encryptBlobBytes } from "../../data/documents/blob/shared/crypto";
import {
  signBlobAttachmentEvent,
  signBlobAttachmentWriteHeader,
} from "../../data/documents/blob/shared/events";
import {
  authorizingContainerPathRecords,
  deriveBlobTargetsFromDocumentProjection,
  wrapBlobContentKey,
} from "../../data/documents/blob/shared/projection";
import { readDocumentManifestIdentity } from "../../data/documents/blob/shared/readers";
import { assertBlobAttachmentBindResponse } from "../../data/documents/blob/shared/responses";
import type {
  BlobAttachmentApi,
  BlobAttachmentMaterial,
  UploadDocumentAttachmentInput,
  UploadDocumentAttachmentResult,
} from "../../data/documents/blob/shared/types";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import { uniqueSortedStrings } from "../../data/documents/shared/readers";
import {
  type DocumentCreateAuthor,
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
} from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

type MultipartBlobAttachmentApi = BlobAttachmentApi &
  Required<
    Pick<
      BlobAttachmentApi,
      | "completeMultipartBlobStage"
      | "getMultipartBlobStage"
      | "initiateMultipartBlobStage"
      | "uploadMultipartBlobPart"
    >
  >;

const TEXT_ENCODER = new TextEncoder();
const DEFAULT_MULTIPART_UPLOAD_CONCURRENCY = 4;

interface MultipartPartCommit {
  readonly etag: string;
  readonly partNumber: number;
}

interface MultipartPartUploadTask {
  readonly encryptedPart: string;
  readonly partIndex: number;
  readonly partNumber: number;
}

function requireMultipartBlobAttachmentApi(
  apiClient: BlobAttachmentApi,
): MultipartBlobAttachmentApi {
  if (
    typeof apiClient.completeMultipartBlobStage !== "function" ||
    typeof apiClient.getMultipartBlobStage !== "function" ||
    typeof apiClient.initiateMultipartBlobStage !== "function" ||
    typeof apiClient.uploadMultipartBlobPart !== "function"
  ) {
    throw new Error("Multipart blob upload API is unavailable");
  }

  return apiClient as MultipartBlobAttachmentApi;
}

function splitEncryptedBytesIntoParts(
  encryptedBytes: string,
  partSize: number,
): string[] {
  if (!Number.isInteger(partSize) || partSize <= 0) {
    throw new Error("Multipart blob part size must be a positive integer");
  }

  if (encryptedBytes.length === 0) {
    return [];
  }
  if (isAsciiString(encryptedBytes)) {
    const parts: string[] = [];
    for (let start = 0; start < encryptedBytes.length; start += partSize) {
      parts.push(encryptedBytes.slice(start, start + partSize));
    }

    return parts;
  }

  return splitUnicodeEncryptedBytesIntoParts(encryptedBytes, partSize);
}

function isAsciiString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode > 0x7f) {
      return false;
    }
  }

  return true;
}

function splitUnicodeEncryptedBytesIntoParts(
  encryptedBytes: string,
  partSize: number,
): string[] {
  const parts: string[] = [];
  let currentPart = "";
  let currentPartLength = 0;

  for (const character of encryptedBytes) {
    const characterLength = TEXT_ENCODER.encode(character).byteLength;
    if (characterLength > partSize) {
      throw new Error("Multipart blob part size is too small");
    }
    if (
      currentPart.length > 0 &&
      currentPartLength + characterLength > partSize
    ) {
      parts.push(currentPart);
      currentPart = "";
      currentPartLength = 0;
    }

    currentPart += character;
    currentPartLength += characterLength;
  }

  if (currentPart.length > 0) {
    parts.push(currentPart);
  }

  return parts;
}

function partByteLength(encryptedBytes: string): number {
  return TEXT_ENCODER.encode(encryptedBytes).byteLength;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256BytesHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

function blobPartBytesToStream(
  bytes: Uint8Array<ArrayBuffer>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function normalizeMultipartUploadConcurrency(
  value: number | undefined,
): number {
  if (value === undefined) {
    return DEFAULT_MULTIPART_UPLOAD_CONCURRENCY;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      "Multipart blob upload concurrency must be a positive integer",
    );
  }

  return value;
}

function isMultipartPartCommit(
  part: MultipartPartCommit | undefined,
): part is MultipartPartCommit {
  return part !== undefined;
}

async function uploadMultipartPartTasks(input: {
  readonly apiClient: MultipartBlobAttachmentApi;
  readonly completeParts: (MultipartPartCommit | undefined)[];
  readonly concurrency: number;
  readonly stageId: string;
  readonly tasks: readonly MultipartPartUploadTask[];
  readonly uploadId: string;
}): Promise<boolean> {
  let failed = false;
  let nextTaskIndex = 0;

  async function worker(): Promise<void> {
    while (!failed) {
      const task = input.tasks[nextTaskIndex];
      nextTaskIndex += 1;
      if (!task) {
        return;
      }

      const uploaded = input.apiClient.uploadMultipartBlobPartBytes
        ? await uploadMultipartPartBytes({
            apiClient: input.apiClient,
            stageId: input.stageId,
            task,
            uploadId: input.uploadId,
          })
        : await input.apiClient.uploadMultipartBlobPart(
            input.stageId,
            task.partNumber,
            {
              encryptedBytes: task.encryptedPart,
              uploadId: input.uploadId,
            },
          );
      if (!uploaded) {
        failed = true;
        return;
      }

      input.completeParts[task.partIndex] = {
        etag: uploaded.part.etag,
        partNumber: task.partNumber,
      };
    }
  }

  const workerCount = Math.min(input.concurrency, input.tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return !failed;
}

async function uploadMultipartPartBytes(input: {
  readonly apiClient: MultipartBlobAttachmentApi;
  readonly stageId: string;
  readonly task: MultipartPartUploadTask;
  readonly uploadId: string;
}): ReturnType<MultipartBlobAttachmentApi["uploadMultipartBlobPart"]> {
  if (!input.apiClient.uploadMultipartBlobPartBytes) {
    return input.apiClient.uploadMultipartBlobPart(
      input.stageId,
      input.task.partNumber,
      {
        encryptedBytes: input.task.encryptedPart,
        uploadId: input.uploadId,
      },
    );
  }

  const encryptedPartBytes = TEXT_ENCODER.encode(input.task.encryptedPart);
  return input.apiClient.uploadMultipartBlobPartBytes(
    input.stageId,
    input.task.partNumber,
    {
      byteLength: encryptedPartBytes.byteLength,
      encryptedBytes: blobPartBytesToStream(encryptedPartBytes),
      sha256: await sha256BytesHex(encryptedPartBytes),
      uploadId: input.uploadId,
    },
  );
}

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
  author: DocumentCreateAuthor;
  bindingId: string;
  blobId: string;
  contentKeyEpoch: number;
  documentId: string;
  eventId: string;
  expectedBindingId: string | null;
  material: BlobAttachmentMaterial;
  multipart: UploadDocumentAttachmentInput["multipart"];
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
  const stageId = input.multipart
    ? await stageMultipartBlobAttachment({
        apiClient: input.apiClient,
        encryptedBytes: input.material.encrypted.encryptedBytes,
        multipart: input.multipart,
        byteLength: input.material.encrypted.byteLength,
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

function uploadedPartsByPartNumber(
  parts: readonly MultipartBlobStagePart[],
): ReadonlyMap<number, MultipartBlobStagePart> {
  return new Map(parts.map((part) => [part.partNumber, part]));
}

async function stageMultipartBlobAttachment(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly byteLength: number;
  readonly encryptedBytes: string;
  readonly multipart: NonNullable<UploadDocumentAttachmentInput["multipart"]>;
  readonly sha256: string;
}): Promise<string | null> {
  const apiClient = requireMultipartBlobAttachmentApi(input.apiClient);
  const stage =
    input.multipart.existingStage ??
    (await apiClient.initiateMultipartBlobStage({
      byteLength: input.byteLength,
      sha256: input.sha256,
    }));
  if (!stage) {
    return null;
  }

  const refreshedStage = input.multipart.existingStage
    ? await apiClient.getMultipartBlobStage(stage.stageId)
    : null;
  const status =
    refreshedStage ??
    ("completed" in stage
      ? stage
      : {
          ...stage,
          completed: false,
        });
  if (status.completed) {
    return status.stageId;
  }

  const uploadedParts = uploadedPartsByPartNumber(status.uploadedParts);
  const encryptedParts = splitEncryptedBytesIntoParts(
    input.encryptedBytes,
    input.multipart.partSize,
  );
  const completeParts: (MultipartPartCommit | undefined)[] = new Array(
    encryptedParts.length,
  );
  const uploadTasks: MultipartPartUploadTask[] = [];

  for (const [partIndex, encryptedPart] of encryptedParts.entries()) {
    const partNumber = partIndex + 1;
    const uploadedPart = uploadedParts.get(partNumber);
    if (uploadedPart?.byteLength === partByteLength(encryptedPart)) {
      completeParts[partIndex] = {
        etag: uploadedPart.etag,
        partNumber,
      };
      continue;
    }

    uploadTasks.push({
      encryptedPart,
      partIndex,
      partNumber,
    });
  }
  const uploaded = await uploadMultipartPartTasks({
    apiClient,
    completeParts,
    concurrency: normalizeMultipartUploadConcurrency(
      input.multipart.uploadConcurrency,
    ),
    stageId: stage.stageId,
    tasks: uploadTasks,
    uploadId: stage.uploadId,
  });
  if (!uploaded) {
    return null;
  }
  const committedParts = completeParts.filter(isMultipartPartCommit);
  if (committedParts.length !== encryptedParts.length) {
    return null;
  }

  const completed = await apiClient.completeMultipartBlobStage(stage.stageId, {
    parts: committedParts,
    uploadId: stage.uploadId,
  });

  return completed?.stageId ?? null;
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
  multipart,
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
    multipart,
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
