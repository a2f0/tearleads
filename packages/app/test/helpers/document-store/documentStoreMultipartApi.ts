import type { DocumentsRuntimeInput } from "./documentStoreSyncFixtures";

interface StoredPart {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly etag: string;
  readonly partNumber: number;
}

interface StoredStage {
  readonly organizationId: string;
  readonly byteLength: number;
  completedBytes: Uint8Array<ArrayBuffer> | null;
  readonly parts: Map<number, StoredPart>;
  readonly sha256: string;
  readonly stageId: string;
  readonly uploadId: string;
}

const EXPIRES_AT = "2026-04-27T00:05:00.000Z";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
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

function concatenateParts(parts: readonly StoredPart[]) {
  const byteLength = parts.reduce(
    (total, part) => total + part.bytes.byteLength,
    0,
  );
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part.bytes, offset);
    offset += part.bytes.byteLength;
  }
  return bytes;
}

type MultipartApi = Pick<
  DocumentsRuntimeInput["apiClient"],
  | "getMultipartBlobStage"
  | "initiateMultipartBlobStage"
  | "uploadMultipartBlobPartBytes"
>;

export function createDocumentStoreMultipartApi(): {
  readonly api: MultipartApi;
  /** What an attachment bind does: assemble and verify the staged parts. */
  completeAsBind(stageId: string): Promise<{
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly sha256: string;
  } | null>;
} {
  const stages = new Map<string, StoredStage>();
  let stageCount = 0;

  const api: MultipartApi = {
    async initiateMultipartBlobStage(request) {
      stageCount += 1;
      const stageId = `stage-${stageCount}`;
      const { firstParts, ...declared } = request;
      const stage: StoredStage = {
        ...declared,
        completedBytes: null,
        parts: new Map(),
        stageId,
        uploadId: `upload-${stageCount}`,
      };
      stages.set(stageId, stage);
      return {
        ...declared,
        expiresAt: EXPIRES_AT,
        partUploads: firstParts.map((part) => ({
          ...part,
          source: { kind: "api" as const },
        })),
        stageId,
        uploadId: stage.uploadId,
        uploadedParts: [],
      };
    },
    async getMultipartBlobStage(stageId) {
      const stage = stages.get(stageId);
      if (!stage) return null;
      return {
        organizationId: stage.organizationId,
        byteLength: stage.byteLength,
        completed: stage.completedBytes !== null,
        expiresAt: EXPIRES_AT,
        sha256: stage.sha256,
        stageId,
        uploadId: stage.uploadId,
        uploadedParts: [...stage.parts.values()].map((part) => ({
          byteLength: part.bytes.byteLength,
          etag: part.etag,
          partNumber: part.partNumber,
        })),
      };
    },
    async uploadMultipartBlobPartBytes(stageId, partNumber, request) {
      const stage = stages.get(stageId);
      if (!stage || stage.uploadId !== request.uploadId) return null;
      const bytes = await copyUploadBytes(request.encryptedBytes);
      if (
        bytes.byteLength !== request.byteLength ||
        (await sha256Hex(bytes)) !== request.sha256
      ) {
        return null;
      }
      const etag = `etag-${partNumber}-${request.sha256}`;
      stage.parts.set(partNumber, { bytes, etag, partNumber });
      return {
        part: { byteLength: bytes.byteLength, etag, partNumber },
        stageId,
        uploadId: stage.uploadId,
      };
    },
  };

  return {
    api,
    async completeAsBind(stageId) {
      const stage = stages.get(stageId);
      if (!stage) return null;
      if (!stage.completedBytes) {
        const bytes = concatenateParts(
          [...stage.parts.values()].sort(
            (left, right) => left.partNumber - right.partNumber,
          ),
        );
        if (
          bytes.byteLength !== stage.byteLength ||
          (await sha256Hex(bytes)) !== stage.sha256
        ) {
          throw new Error("Multipart test stage bytes do not match");
        }
        stage.completedBytes = bytes;
      }
      return { bytes: stage.completedBytes.slice(), sha256: stage.sha256 };
    },
  };
}
