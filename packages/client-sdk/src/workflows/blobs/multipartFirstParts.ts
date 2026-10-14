import { describeMultipartBlobPart } from "@tearleads/api-client";
import { bytesToHex } from "@tearleads/crypto";
import type { InitiateMultipartBlobStageResponse } from "@tearleads/validators/response";
import {
  MAX_INITIATE_PART_UPLOADS,
  type MultipartBlobPartDescriptor,
  type MultipartBlobPartUploadSource,
} from "@tearleads/validators/util";
import type { BlobBytes } from "../../data/blobContracts";
import type { BlobEncryptionPlan } from "../../data/documents/blob/shared/crypto";

export interface PreparedMultipartPart {
  readonly bytes: BlobBytes;
  readonly sha256: string;
}

/**
 * The parts a new stage's upload starts with, encrypted once up front: their
 * descriptors ride on the stage initiation, and their bytes are handed to the
 * upload workers instead of being encrypted a second time.
 */
export interface MultipartFirstParts {
  readonly descriptors: readonly MultipartBlobPartDescriptor[];
  readonly prepared: Map<number, PreparedMultipartPart>;
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
  encryption: BlobEncryptionPlan,
  concurrency: number,
): Promise<MultipartFirstParts> {
  const count = Math.min(
    encryption.partCount,
    concurrency,
    MAX_INITIATE_PART_UPLOADS,
  );
  const descriptors: MultipartBlobPartDescriptor[] = [];
  const prepared = new Map<number, PreparedMultipartPart>();
  for (let partIndex = 0; partIndex < count; partIndex += 1) {
    const bytes = await encryption.encryptPart(partIndex);
    if (bytes.byteLength !== encryption.getPartByteLength(partIndex)) {
      throw new Error(
        `Encrypted blob part ${partIndex + 1} byte length mismatch: expected ${encryption.getPartByteLength(partIndex).toLocaleString()}, received ${bytes.byteLength.toLocaleString()}.`,
      );
    }
    prepared.set(partIndex, { bytes, sha256: await sha256BytesHex(bytes) });
    descriptors.push(describeMultipartBlobPart(partIndex + 1, bytes));
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
