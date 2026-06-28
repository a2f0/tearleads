import type {
  InitiateMultipartBlobStageResponse,
  MultipartBlobStagePart,
  MultipartBlobStageStatusResponse,
} from "@tearleads/validators/response";
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
const MAX_MULTIPART_UPLOAD_PARTS = 10_000;

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

interface ApiFailureReporter {
  getLastRequestFailure?: () => { readonly message: string } | null;
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

function isApiFailureReporter(
  apiClient: BlobAttachmentApi,
): apiClient is BlobAttachmentApi & ApiFailureReporter {
  return typeof Reflect.get(apiClient, "getLastRequestFailure") === "function";
}

function describeLastApiFailure(apiClient: BlobAttachmentApi): string | null {
  if (!isApiFailureReporter(apiClient)) {
    return null;
  }

  const failure = apiClient.getLastRequestFailure?.();
  return failure?.message ?? null;
}

function multipartApiFailureMessage(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly fallback: string;
}): string {
  const failure = describeLastApiFailure(input.apiClient);
  return failure
    ? `${input.fallback} Last API failure: ${failure}`
    : input.fallback;
}

export function splitEncryptedBytesIntoParts(
  encryptedBytes: string,
  partSize: number,
): string[] {
  if (!Number.isInteger(partSize) || partSize <= 0) {
    throw new Error("Multipart blob part size must be a positive integer");
  }
  // Encrypted blob payloads are the canonical-JSON serialization of base64/hex
  // fields, so they are always ASCII: one byte per character, and the byte
  // budget equals the character budget. Assert that invariant rather than carry
  // a UTF-8-aware splitter for input that cannot occur.
  if (!isAsciiString(encryptedBytes)) {
    throw new Error("Multipart blob payload must be ASCII");
  }

  const parts: string[] = [];
  for (let start = 0; start < encryptedBytes.length; start += partSize) {
    parts.push(encryptedBytes.slice(start, start + partSize));
  }

  return parts;
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
}): Promise<void> {
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
          throw new Error(
            multipartApiFailureMessage({
              apiClient: input.apiClient,
              fallback: `Multipart blob part ${task.partNumber} upload failed for stage ${input.stageId}.`,
            }),
          );
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
      encryptedBytes: encryptedPartBytes,
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

function isMultipartStageStatus(
  stage: InitiateMultipartBlobStageResponse | MultipartBlobStageStatusResponse,
): stage is MultipartBlobStageStatusResponse {
  return "completed" in stage && typeof stage.completed === "boolean";
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
    // Parts come from splitEncryptedBytesIntoParts, which guarantees ASCII, so
    // the UTF-8 byte length equals the string length.
    const byteLength = encryptedPart.length;
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

async function resolveMultipartStageStatus(input: {
  readonly apiClient: MultipartBlobAttachmentApi;
  readonly byteLength: number;
  readonly multipart: NonNullable<UploadDocumentAttachmentInput["multipart"]>;
  readonly sha256: string;
}): Promise<MultipartBlobStageStatusResponse> {
  const stage =
    input.multipart.existingStage ??
    (await input.apiClient.initiateMultipartBlobStage({
      byteLength: input.byteLength,
      sha256: input.sha256,
    }));
  if (!stage) {
    throw new Error(
      multipartApiFailureMessage({
        apiClient: input.apiClient,
        fallback: `Multipart blob stage initiation failed for ${input.byteLength.toLocaleString()} bytes.`,
      }),
    );
  }

  const refreshedStage = input.multipart.existingStage
    ? await input.apiClient.getMultipartBlobStage(stage.stageId)
    : null;
  if (input.multipart.existingStage && !refreshedStage) {
    throw new Error(
      multipartApiFailureMessage({
        apiClient: input.apiClient,
        fallback: `Multipart blob stage status refresh failed for stage ${stage.stageId}.`,
      }),
    );
  }

  return (
    refreshedStage ??
    (isMultipartStageStatus(stage)
      ? stage
      : {
          ...stage,
          completed: false,
        })
  );
}

function assertMultipartPartLimit(parts: readonly string[]): void {
  if (parts.length <= MAX_MULTIPART_UPLOAD_PARTS) {
    return;
  }

  throw new Error(
    `Multipart blob upload would require ${parts.length.toLocaleString()} parts; the maximum is ${MAX_MULTIPART_UPLOAD_PARTS.toLocaleString()}. Increase the multipart part size.`,
  );
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
  const status = await resolveMultipartStageStatus({
    apiClient,
    byteLength: input.byteLength,
    multipart: input.multipart,
    sha256: input.sha256,
  });
  if (status.completed) {
    return status.stageId;
  }

  const encryptedParts = splitEncryptedBytesIntoParts(
    input.encryptedBytes,
    input.multipart.partSize,
  );
  assertMultipartPartLimit(encryptedParts);
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

  await uploadMultipartPartTasks({
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
    stageId: status.stageId,
    tasks: uploadTasks,
    uploadId: status.uploadId,
  });
  const committedParts = completeParts.filter(isMultipartPartCommit);
  if (committedParts.length !== encryptedParts.length) {
    throw new Error(
      `Multipart blob upload incomplete for stage ${status.stageId}: committed ${committedParts.length.toLocaleString()} of ${encryptedParts.length.toLocaleString()} parts.`,
    );
  }

  const completed = await apiClient.completeMultipartBlobStage(status.stageId, {
    parts: committedParts,
    uploadId: status.uploadId,
  });
  if (!completed) {
    throw new Error(
      multipartApiFailureMessage({
        apiClient,
        fallback: `Multipart blob stage completion failed for stage ${status.stageId} with ${committedParts.length.toLocaleString()} committed parts.`,
      }),
    );
  }

  return completed.stageId;
}
