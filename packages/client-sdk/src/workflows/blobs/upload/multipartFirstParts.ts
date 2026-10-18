import { describeMultipartBlobPart } from "@tearleads/api-client";
import { bytesToHex } from "@tearleads/crypto";
import type { InitiateMultipartBlobStageResponse } from "@tearleads/validators/response";
import {
  MAX_INITIATE_PART_UPLOADS,
  type MultipartBlobPartDescriptor,
  type MultipartBlobPartUploadSource,
} from "@tearleads/validators/util";
import type { BlobBytes } from "../../../data/blobs/blobContracts";
import {
  acquireBlobTransferPermit,
  type BlobTransferPermit,
  tryAcquireBlobTransferPermit,
} from "../../../data/blobs/transferPool";
import type { BlobEncryptionPlan } from "../../../data/documents/blob/shared/crypto";

export interface PreparedMultipartPart {
  readonly bytes: BlobBytes;
  readonly sha256: string;
}

/**
 * A first part's bytes and the transfer-pool permit that pays for them: the
 * bytes exist before their upload can start, so they hold a slot of the
 * client's byte-I/O bound until the upload that sends them releases it.
 */
export interface PreparedFirstPart extends PreparedMultipartPart {
  readonly permit: BlobTransferPermit;
}

/**
 * The parts a new stage's upload starts with, encrypted once up front: their
 * descriptors ride on the stage initiation, and their bytes are handed to the
 * upload workers instead of being encrypted a second time.
 */
export interface MultipartFirstParts {
  readonly descriptors: readonly MultipartBlobPartDescriptor[];
  readonly prepared: Map<number, PreparedFirstPart>;
}

/** Return the pool slots of first parts no upload consumed. */
export function releasePreparedParts(
  prepared: Map<number, PreparedFirstPart>,
): void {
  for (const part of prepared.values()) {
    part.permit.release();
  }
  prepared.clear();
}

/**
 * One permit is awaited; more are taken only if free right now. Two uploads
 * each waiting for a second slot while holding a first could otherwise
 * deadlock the pool, since a held slot frees only when its part uploads.
 */
async function acquireFirstPartPermits(
  client: object,
  limit: number,
): Promise<BlobTransferPermit[]> {
  const permits = [await acquireBlobTransferPermit(client)];
  while (permits.length < limit) {
    const permit = tryAcquireBlobTransferPermit(client);
    if (!permit) break;
    permits.push(permit);
  }
  return permits;
}

/**
 * Where each part's bytes go. Sources the stage initiation issued are used
 * once; a store that cannot sign (`api`) needs no per-part authorization at
 * all, and a part with no source authorizes just before it is sent.
 */
export interface MultipartPartSources {
  readonly apiTransport: boolean;
  readonly issued: Map<number, MultipartBlobPartUploadSource>;
}

export async function sha256BytesHex(bytes: BlobBytes): Promise<string> {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

export async function prepareFirstMultipartParts(
  client: object,
  encryption: BlobEncryptionPlan,
  concurrency: number,
): Promise<MultipartFirstParts> {
  const permits = await acquireFirstPartPermits(
    client,
    Math.min(encryption.partCount, concurrency, MAX_INITIATE_PART_UPLOADS),
  );
  const descriptors: MultipartBlobPartDescriptor[] = [];
  const prepared = new Map<number, PreparedFirstPart>();
  try {
    for (const [partIndex, permit] of permits.entries()) {
      const bytes = await encryption.encryptPart(partIndex);
      if (bytes.byteLength !== encryption.getPartByteLength(partIndex)) {
        throw new Error(
          `Encrypted blob part ${partIndex + 1} byte length mismatch: expected ${encryption.getPartByteLength(partIndex).toLocaleString()}, received ${bytes.byteLength.toLocaleString()}.`,
        );
      }
      const sha256 = await sha256BytesHex(bytes);
      prepared.set(partIndex, { bytes, permit, sha256 });
      descriptors.push(describeMultipartBlobPart(partIndex + 1, bytes));
    }
  } catch (error) {
    for (const permit of permits) permit.release();
    throw error;
  }
  return { descriptors, prepared };
}

/**
 * The initiation must return exactly one source per described part, for that
 * part's number, length, and checksum, and every source of one stage must use
 * the same transport.
 */
export function readIssuedPartSources(
  descriptors: readonly MultipartBlobPartDescriptor[],
  stage: Pick<InitiateMultipartBlobStageResponse, "partUploads">,
): MultipartPartSources {
  const issued = new Map<number, MultipartBlobPartUploadSource>();
  const kinds = new Set(stage.partUploads.map((upload) => upload.source.kind));
  const matches =
    stage.partUploads.length === descriptors.length &&
    kinds.size === 1 &&
    descriptors.every((descriptor, index) => {
      const upload = stage.partUploads[index];
      return (
        upload?.partNumber === descriptor.partNumber &&
        upload.byteLength === descriptor.byteLength &&
        upload.contentMd5 === descriptor.contentMd5
      );
    });
  if (!matches) {
    throw new Error(
      "Multipart blob stage initiation part uploads do not match its request.",
    );
  }
  for (const upload of stage.partUploads) {
    issued.set(upload.partNumber, upload.source);
  }
  return { apiTransport: kinds.has("api"), issued };
}

/** Use each issued source once; retries and later parts authorize anew. */
export function takePartSource(
  sources: MultipartPartSources,
  partNumber: number,
): MultipartBlobPartUploadSource | undefined {
  const issued = sources.issued.get(partNumber);
  sources.issued.delete(partNumber);
  return issued ?? (sources.apiTransport ? { kind: "api" } : undefined);
}
