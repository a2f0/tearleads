import type { MultipartBlobStagePart } from "@tearleads/validators/response";
import type {
  BlobAttachmentApi,
  MultipartUploadProgressListener,
  UploadDocumentAttachmentInput,
} from "../../data/documents/blob/shared/types";
import {
  type MultipartBlobAttachmentApi,
  requireMultipartBlobAttachmentApi,
} from "./automaticMultipartUpload";

const TEXT_ENCODER = new TextEncoder();
const DEFAULT_MULTIPART_UPLOAD_CONCURRENCY = 4;

interface MultipartPartCommit {
  readonly etag: string;
  readonly partNumber: number;
}

interface MultipartPartUploadTask {
  readonly byteLength: number;
  readonly encryptedPart: string;
  readonly partIndex: number;
  readonly partNumber: number;
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
  readonly onPartUploaded?: (task: MultipartPartUploadTask) => void;
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

      try {
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
        input.onPartUploaded?.(task);
      } catch (error) {
        // Stop sibling workers from pulling new tasks and firing more uploads
        // once any part rejects; rethrow so Promise.all still surfaces it.
        failed = true;
        throw error;
      }
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

function uploadedPartsByPartNumber(
  parts: readonly MultipartBlobStagePart[],
): ReadonlyMap<number, MultipartBlobStagePart> {
  return new Map(parts.map((part) => [part.partNumber, part]));
}

interface MultipartUploadProgressState {
  bytesTotal: number;
  bytesUploaded: number;
  partsCompleted: number;
  partsTotal: number;
}

interface MultipartPartPlan {
  completeParts: (MultipartPartCommit | undefined)[];
  progress: MultipartUploadProgressState;
  uploadTasks: MultipartPartUploadTask[];
}

/**
 * Splits the encrypted payload into parts, reusing any already-staged parts and
 * seeding cumulative progress so resumed uploads report from where they left
 * off rather than restarting at zero.
 */
function planMultipartParts(input: {
  encryptedParts: readonly string[];
  uploadedParts: ReadonlyMap<number, MultipartBlobStagePart>;
}): MultipartPartPlan {
  const { encryptedParts, uploadedParts } = input;
  const completeParts: (MultipartPartCommit | undefined)[] = new Array(
    encryptedParts.length,
  );
  const uploadTasks: MultipartPartUploadTask[] = [];
  const progress: MultipartUploadProgressState = {
    bytesTotal: 0,
    bytesUploaded: 0,
    partsCompleted: 0,
    partsTotal: encryptedParts.length,
  };

  for (const [partIndex, encryptedPart] of encryptedParts.entries()) {
    const partNumber = partIndex + 1;
    // Encrypted payloads are typically ASCII (base64/hex), where the UTF-8 byte
    // length equals the string length, so we can skip re-encoding the part.
    const byteLength = isAsciiString(encryptedPart)
      ? encryptedPart.length
      : partByteLength(encryptedPart);
    progress.bytesTotal += byteLength;
    const uploadedPart = uploadedParts.get(partNumber);
    if (uploadedPart?.byteLength === byteLength) {
      completeParts[partIndex] = {
        etag: uploadedPart.etag,
        partNumber,
      };
      progress.partsCompleted += 1;
      progress.bytesUploaded += byteLength;
      continue;
    }

    uploadTasks.push({
      byteLength,
      encryptedPart,
      partIndex,
      partNumber,
    });
  }

  return { completeParts, progress, uploadTasks };
}

export async function stageMultipartBlobAttachment(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly byteLength: number;
  readonly encryptedBytes: string;
  readonly multipart: NonNullable<UploadDocumentAttachmentInput["multipart"]>;
  readonly onMultipartProgress?: MultipartUploadProgressListener | undefined;
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

  const encryptedParts = splitEncryptedBytesIntoParts(
    input.encryptedBytes,
    input.multipart.partSize,
  );
  const { completeParts, progress, uploadTasks } = planMultipartParts({
    encryptedParts,
    uploadedParts: uploadedPartsByPartNumber(status.uploadedParts),
  });

  const reportMultipartProgress = () => {
    input.onMultipartProgress?.({
      bytesTotal: progress.bytesTotal,
      bytesUploaded: progress.bytesUploaded,
      partsCompleted: progress.partsCompleted,
      partsTotal: progress.partsTotal,
    });
  };
  reportMultipartProgress();

  const uploaded = await uploadMultipartPartTasks({
    apiClient,
    completeParts,
    concurrency: normalizeMultipartUploadConcurrency(
      input.multipart.uploadConcurrency,
    ),
    onPartUploaded: (task) => {
      progress.partsCompleted += 1;
      progress.bytesUploaded += task.byteLength;
      reportMultipartProgress();
    },
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
