import {
  type AccessEvent,
  bytesToHex,
  computeAccessEventHash,
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
} from "@tearleads/crypto";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  DocumentCreateResponse,
} from "@tearleads/validators/response";
import type { BlobAttachmentApi } from "../../src/data/documents/blob/shared/types";
import {
  readWriteHeader,
  uniqueSortedStrings,
} from "../../src/data/documents/shared/readers";

const DEFAULT_MULTIPART_EXPIRES_AT = "2099-01-01T00:00:00.000Z";
const DEFAULT_MULTIPART_STAGE_ID = "35069150-b8c1-4052-8003-9780f080aa08";
const DEFAULT_MULTIPART_UPLOAD_ID = "multipart-upload-fixture";

type CompleteMultipartBlobStage = NonNullable<
  BlobAttachmentApi["completeMultipartBlobStage"]
>;
type GetMultipartBlobStage = NonNullable<
  BlobAttachmentApi["getMultipartBlobStage"]
>;
type InitiateMultipartBlobStage = NonNullable<
  BlobAttachmentApi["initiateMultipartBlobStage"]
>;
type UploadMultipartBlobPartBytes = NonNullable<
  BlobAttachmentApi["uploadMultipartBlobPartBytes"]
>;

interface StoredMultipartPart {
  readonly byteLength: number;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly etag: string;
  readonly partNumber: number;
}

interface MultipartBlobStageFixture {
  readonly completeMultipartBlobStage: CompleteMultipartBlobStage;
  readonly getAssembledBytes: () => Uint8Array<ArrayBuffer> | null;
  readonly getMultipartBlobStage: GetMultipartBlobStage;
  readonly initiateMultipartBlobStage: InitiateMultipartBlobStage;
  readonly uploadMultipartBlobPartBytes: UploadMultipartBlobPartBytes;
}

interface MultipartBlobStageFixtureOptions {
  readonly stageId?: string | undefined;
  readonly uploadId?: string | undefined;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

async function copyUploadBytes(
  body: Blob | BufferSource,
): Promise<Uint8Array<ArrayBuffer>> {
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body.slice(0));
  }

  return Uint8Array.from(
    new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
  );
}

function concatenateParts(
  parts: readonly StoredMultipartPart[],
): Uint8Array<ArrayBuffer> {
  const byteLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part.bytes, offset);
    offset += part.byteLength;
  }

  return bytes;
}

export function createMultipartBlobStageFixture(
  options: MultipartBlobStageFixtureOptions = {},
): MultipartBlobStageFixture {
  const stageId = options.stageId ?? DEFAULT_MULTIPART_STAGE_ID;
  const uploadId = options.uploadId ?? DEFAULT_MULTIPART_UPLOAD_ID;
  const parts = new Map<number, StoredMultipartPart>();
  let assembledBytes: Uint8Array<ArrayBuffer> | null = null;
  let completed = false;
  let initiatedRequest: {
    readonly byteLength: number;
    readonly sha256: string;
    readonly organizationId: string;
  } | null = null;

  const initiateMultipartBlobStage: InitiateMultipartBlobStage = async (
    request,
  ) => {
    if (initiatedRequest !== null) {
      throw new Error("Multipart blob stage fixture is already initiated");
    }
    initiatedRequest = { ...request };

    return {
      ...request,
      expiresAt: DEFAULT_MULTIPART_EXPIRES_AT,
      stageId,
      uploadId,
      uploadedParts: [],
    };
  };

  const getMultipartBlobStage: GetMultipartBlobStage = async (
    requestedStageId,
  ) => {
    if (requestedStageId !== stageId || initiatedRequest === null) {
      return null;
    }

    return {
      ...initiatedRequest,
      completed,
      expiresAt: DEFAULT_MULTIPART_EXPIRES_AT,
      stageId,
      uploadId,
      uploadedParts: completed
        ? []
        : [...parts.values()]
            .sort((left, right) => left.partNumber - right.partNumber)
            .map(({ byteLength, etag, partNumber }) => ({
              byteLength,
              etag,
              partNumber,
            })),
    };
  };

  const uploadMultipartBlobPartBytes: UploadMultipartBlobPartBytes = async (
    requestedStageId,
    partNumber,
    request,
  ) => {
    if (requestedStageId !== stageId || initiatedRequest === null) {
      throw new Error("Multipart blob stage fixture is not initiated");
    }
    if (request.uploadId !== uploadId) {
      throw new Error("Multipart blob stage fixture upload id mismatch");
    }
    if (completed) {
      throw new Error("Multipart blob stage fixture is complete");
    }

    const bytes = await copyUploadBytes(request.encryptedBytes);
    if (bytes.byteLength !== request.byteLength) {
      throw new Error("Multipart blob part byteLength mismatch");
    }
    const partSha256 = await sha256Hex(bytes);
    if (partSha256 !== request.sha256) {
      throw new Error("Multipart blob part sha256 mismatch");
    }
    const etag = `fixture-etag-${partNumber}-${partSha256}`;
    const part = {
      byteLength: bytes.byteLength,
      bytes,
      etag,
      partNumber,
    } satisfies StoredMultipartPart;
    parts.set(partNumber, part);

    return {
      part: { byteLength: part.byteLength, etag, partNumber },
      stageId,
      uploadId,
    };
  };

  const completeMultipartBlobStage: CompleteMultipartBlobStage = async (
    requestedStageId,
    request,
  ) => {
    if (requestedStageId !== stageId || initiatedRequest === null) {
      throw new Error("Multipart blob stage fixture is not initiated");
    }
    if (request.uploadId !== uploadId) {
      throw new Error("Multipart blob stage fixture upload id mismatch");
    }

    const seenPartNumbers = new Set<number>();
    const committedParts = [...request.parts]
      .sort((left, right) => left.partNumber - right.partNumber)
      .map((commit) => {
        if (seenPartNumbers.has(commit.partNumber)) {
          throw new Error(
            "Multipart blob stage fixture contains duplicate parts",
          );
        }
        seenPartNumbers.add(commit.partNumber);

        const storedPart = parts.get(commit.partNumber);
        if (!storedPart || storedPart.etag !== commit.etag) {
          throw new Error("Multipart blob stage fixture part not found");
        }
        return storedPart;
      });
    const assembled = concatenateParts(committedParts);
    if (assembled.byteLength !== initiatedRequest.byteLength) {
      throw new Error("Multipart blob stage fixture byteLength mismatch");
    }
    if ((await sha256Hex(assembled)) !== initiatedRequest.sha256) {
      throw new Error("Multipart blob stage fixture sha256 mismatch");
    }

    assembledBytes = assembled;
    completed = true;
    return {
      organizationId: initiatedRequest.organizationId,
      byteLength: initiatedRequest.byteLength,
      expiresAt: DEFAULT_MULTIPART_EXPIRES_AT,
      sha256: initiatedRequest.sha256,
      stageId,
    };
  };

  return {
    completeMultipartBlobStage,
    getAssembledBytes: () => assembledBytes?.slice() ?? null,
    getMultipartBlobStage,
    initiateMultipartBlobStage,
    uploadMultipartBlobPartBytes,
  };
}

export async function createBlobAttachmentBindResponse(input: {
  readonly blobId: string;
  readonly documentManifest: DocumentCreateResponse["accessManifest"];
  readonly request: BlobAttachmentBindRequest;
}): Promise<BlobAttachmentBindResponse> {
  const body = input.request.body as Record<string, unknown>;
  const bindingId = String(Reflect.get(body, "bindingId"));
  const documentId = String(Reflect.get(body, "documentId"));
  const slotId = String(Reflect.get(body, "slotId"));
  const organizationId = String(
    Reflect.get(input.documentManifest.state, "organizationId"),
  );
  const targets = input.request.contentKeyBundle.targets.map((target) => ({
    bindingId: target.bindingId,
    containerId: target.containerId,
    containerKeyEpoch: target.containerKeyEpoch,
    containerKeyEpochId: target.containerKeyEpochId,
    containerManifestHash: target.containerManifestHash,
    documentId: target.documentId,
  }));
  const linkedContainerManifestHashes = uniqueSortedStrings(
    targets.map((target) => target.containerManifestHash),
  );
  const linkedContainerKeyEpochIds = uniqueSortedStrings(
    targets.map((target) => target.containerKeyEpochId),
  );
  const blobAccessManifestHash = await computeBlobAccessManifestHash({
    version: 1,
    activeBindingIds: [bindingId],
    blobId: input.blobId,
    blobKeyTargetHash: input.request.contentKeyBundle.targetHash,
    documentManifestHashes: [input.documentManifest.manifestHash],
    linkedContainerKeyEpochIds,
    linkedContainerManifestHashes,
    organizationId,
  });
  const stagedWriteHeader = input.request.stagedBlob?.writeHeader;
  if (!stagedWriteHeader)
    throw new Error("Upload fixture requires a staged write header");

  return {
    bindingEvent: {
      body: input.request.body,
      event: input.request.event,
      eventHash: await computeAccessEventHash(
        input.request.event as unknown as AccessEvent,
      ),
    },
    bindingId,
    blobId: input.blobId,
    documentId,
    documentManifestHash: input.documentManifest.manifestHash,
    previousBindingId:
      typeof Reflect.get(body, "expectedBindingId") === "string"
        ? String(Reflect.get(body, "expectedBindingId"))
        : null,
    slotId,
    blobKekTargets: {
      activeBindingIds: [bindingId],
      blobAccessManifestHash,
      blobId: input.blobId,
      blobKeyTargetHash: input.request.contentKeyBundle.targetHash,
      documentManifestHashes: [input.documentManifest.manifestHash],
      linkedContainerKeyEpochIds,
      linkedContainerManifestHashes,
      organizationId,
      targets,
    },
    writeAuthorization: {
      activeBindingIds: [bindingId],
      blobAccessManifestHash,
      blobId: input.blobId,
      blobKeyTargetHash: input.request.contentKeyBundle.targetHash,
      documentManifestHashes: [input.documentManifest.manifestHash],
      linkedContainerKeyEpochIds,
      linkedContainerManifestHashes,
      organizationId,
      targets,
    },
    contentKeyBundle: {
      blobId: input.blobId,
      ...input.request.contentKeyBundle,
    },
    writeHeader: stagedWriteHeader,
    writeHeaderHash: await computeWriteHeaderHash(
      readWriteHeader(stagedWriteHeader, "Staged blob write header"),
    ),
  };
}
