import { bytesToHex } from "@symcrypt/crypto";
import type {
  InitiateMultipartBlobStageResponse,
  MultipartBlobStagePart,
  MultipartBlobStageStatusResponse,
} from "@symcrypt/validators/response";
import { MAX_BLOB_CHUNK_COUNT } from "../../data/documents/blob/shared/blobEnvelopeV2";
import type { BlobEncryptionPlan } from "../../data/documents/blob/shared/crypto";
import type {
  BlobAttachmentApi,
  MultipartStageResolvedListener,
  MultipartUploadProgressListener,
  UploadDocumentAttachmentInput,
} from "../../data/documents/blob/shared/types";

const DEFAULT_MULTIPART_UPLOAD_CONCURRENCY = 4;
const MAX_MULTIPART_UPLOAD_CONCURRENCY = 4;
const MAX_MULTIPART_PART_BYTES = 5 * 1024 * 1024 * 1024;

interface MultipartPartCommit {
  readonly etag: string;
  readonly partNumber: number;
}

interface MultipartPartUploadTask {
  readonly byteLength: number;
  readonly partIndex: number;
  readonly partNumber: number;
}

type RequestFailureInput = Parameters<
  NonNullable<BlobAttachmentApi["getRequestFailure"]>
>[0];

function pathSegment(value: number | string): string {
  return encodeURIComponent(String(value));
}

function multipartStagePath(stageId: string): string {
  return `/blobs/stages/multipart/${pathSegment(stageId)}`;
}

function multipartPartPath(input: {
  readonly partNumber: number;
  readonly stageId: string;
}): string {
  const basePath = `${multipartStagePath(input.stageId)}/parts/${pathSegment(input.partNumber)}`;
  return `${basePath}/bytes`;
}

function multipartApiFailureMessage(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly fallback: string;
  readonly request: RequestFailureInput;
}): string {
  const failure = input.apiClient.getRequestFailure?.(input.request)?.message;
  return failure
    ? `${input.fallback} Last API failure: ${failure}`
    : input.fallback;
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
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_MULTIPART_UPLOAD_CONCURRENCY
  ) {
    throw new Error(
      `Multipart blob upload concurrency must be between 1 and ${MAX_MULTIPART_UPLOAD_CONCURRENCY}`,
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
  readonly apiClient: BlobAttachmentApi;
  readonly completeParts: (MultipartPartCommit | undefined)[];
  readonly concurrency: number;
  readonly encryption: BlobEncryptionPlan;
  readonly onPartUploaded?: (task: MultipartPartUploadTask) => void;
  readonly stageId: string;
  readonly tasks: readonly MultipartPartUploadTask[];
  readonly uploadId: string;
}): Promise<void> {
  let failed = false;
  let firstFailure: { readonly error: unknown } | undefined;
  let nextTaskIndex = 0;

  async function worker(): Promise<void> {
    while (!failed) {
      const task = input.tasks[nextTaskIndex];
      nextTaskIndex += 1;
      if (!task) {
        return;
      }

      try {
        const uploaded = await uploadMultipartPartBytes({
          apiClient: input.apiClient,
          encryption: input.encryption,
          stageId: input.stageId,
          task,
          uploadId: input.uploadId,
        });
        if (!uploaded) {
          failed = true;
          throw new Error(
            multipartApiFailureMessage({
              apiClient: input.apiClient,
              fallback: `Multipart blob part ${task.partNumber} upload failed for stage ${input.stageId}.`,
              request: {
                method: "PUT",
                path: multipartPartPath({
                  partNumber: task.partNumber,
                  stageId: input.stageId,
                }),
              },
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
        // once any part rejects. Keep this worker alive long enough for the
        // shared join below to drain uploads siblings already started.
        failed = true;
        firstFailure ??= { error };
        return;
      }
    }
  }

  const workerCount = Math.min(input.concurrency, input.tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstFailure) {
    throw firstFailure.error;
  }
}

async function uploadMultipartPartBytes(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly encryption: BlobEncryptionPlan;
  readonly stageId: string;
  readonly task: MultipartPartUploadTask;
  readonly uploadId: string;
}): ReturnType<BlobAttachmentApi["uploadMultipartBlobPartBytes"]> {
  const encryptedPartBytes = await input.encryption.encryptPart(
    input.task.partIndex,
  );
  if (encryptedPartBytes.byteLength !== input.task.byteLength) {
    throw new Error(
      `Encrypted blob part ${input.task.partNumber} byte length mismatch: expected ${input.task.byteLength.toLocaleString()}, received ${encryptedPartBytes.byteLength.toLocaleString()}.`,
    );
  }

  const uploaded = await input.apiClient.uploadMultipartBlobPartBytes(
    input.stageId,
    input.task.partNumber,
    {
      byteLength: encryptedPartBytes.byteLength,
      encryptedBytes: encryptedPartBytes,
      sha256: await sha256BytesHex(encryptedPartBytes),
      uploadId: input.uploadId,
    },
  );
  if (
    uploaded &&
    (uploaded.stageId !== input.stageId ||
      uploaded.uploadId !== input.uploadId ||
      uploaded.part.partNumber !== input.task.partNumber ||
      uploaded.part.byteLength !== input.task.byteLength)
  ) {
    throw new Error(
      `Multipart blob part ${input.task.partNumber} response does not match its request.`,
    );
  }
  return uploaded;
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
 * Plans encrypted part indices without materializing their bytes, reusing any
 * already-staged parts and seeding cumulative progress for resumed uploads.
 */
function planMultipartParts(input: {
  encryption: BlobEncryptionPlan;
  uploadedParts: ReadonlyMap<number, MultipartBlobStagePart>;
}): MultipartPartPlan {
  const { encryption, uploadedParts } = input;
  const completeParts: (MultipartPartCommit | undefined)[] = new Array(
    encryption.partCount,
  );
  const uploadTasks: MultipartPartUploadTask[] = [];
  const progress: MultipartUploadProgressState = {
    bytesTotal: 0,
    bytesUploaded: 0,
    partsCompleted: 0,
    partsTotal: encryption.partCount,
  };

  for (let partIndex = 0; partIndex < encryption.partCount; partIndex += 1) {
    const partNumber = partIndex + 1;
    const byteLength = encryption.getPartByteLength(partIndex);
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
      partIndex,
      partNumber,
    });
  }

  return { completeParts, progress, uploadTasks };
}

async function resolveMultipartStageStatus(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly byteLength: number;
  readonly multipart: NonNullable<UploadDocumentAttachmentInput["multipart"]>;
  readonly sha256: string;
}): Promise<MultipartBlobStageStatusResponse> {
  const resumeStageId = input.multipart.resumeStageId;
  if (resumeStageId) {
    const resumed = await input.apiClient.getMultipartBlobStage(resumeStageId);
    if (!resumed) {
      const request = {
        method: "GET" as const,
        path: multipartStagePath(resumeStageId),
      };
      const failure = input.apiClient.getRequestFailure?.(request);
      const stageIsGone =
        failure?.kind === "http" &&
        (failure.status === 404 || failure.status === 409);
      if (!stageIsGone) {
        throw new Error(
          multipartApiFailureMessage({
            apiClient: input.apiClient,
            fallback: `Multipart blob resume stage lookup failed for stage ${resumeStageId}.`,
            request,
          }),
        );
      }
    }
    if (resumed && resumed.stageId !== resumeStageId) {
      throw new Error(
        `Multipart blob resume response does not match stage ${resumeStageId}.`,
      );
    }
    // Only resume when the stage still exists AND was opened for the same bytes.
    // A sha256 mismatch means the upload no longer reproduces the staged content
    // (or the stage was recycled), so opening a fresh stage is safer than
    // uploading parts that could never assemble to the staged hash.
    if (
      resumed &&
      resumed.byteLength === input.byteLength &&
      resumed.sha256 === input.sha256
    ) {
      return resumed;
    }
  }

  const stage = await input.apiClient.initiateMultipartBlobStage({
    byteLength: input.byteLength,
    sha256: input.sha256,
  });
  if (!stage) {
    throw new Error(
      multipartApiFailureMessage({
        apiClient: input.apiClient,
        fallback: `Multipart blob stage initiation failed for ${input.byteLength.toLocaleString()} bytes.`,
        request: { method: "POST", path: "/blobs/stages/multipart" },
      }),
    );
  }
  if (stage.byteLength !== input.byteLength || stage.sha256 !== input.sha256) {
    throw new Error(
      "Multipart blob stage initiation response does not match its request.",
    );
  }

  return isMultipartStageStatus(stage)
    ? stage
    : {
        ...stage,
        completed: false,
      };
}

function assertMultipartPlanLimits(encryption: BlobEncryptionPlan): void {
  if (encryption.partCount > MAX_BLOB_CHUNK_COUNT) {
    throw new Error(
      `Multipart blob upload would require ${encryption.partCount.toLocaleString()} parts; the maximum is ${MAX_BLOB_CHUNK_COUNT.toLocaleString()} fixed 5 MiB chunks.`,
    );
  }
  for (let index = 0; index < encryption.partCount; index += 1) {
    if (encryption.getPartByteLength(index) > MAX_MULTIPART_PART_BYTES) {
      throw new Error(
        `Encrypted blob part ${index + 1} exceeds the 5 GiB multipart part limit.`,
      );
    }
  }
}

export async function stageMultipartBlobAttachment(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly encryption: BlobEncryptionPlan;
  readonly multipart: NonNullable<UploadDocumentAttachmentInput["multipart"]>;
  readonly onMultipartProgress?: MultipartUploadProgressListener | undefined;
  readonly onStageResolved?: MultipartStageResolvedListener | undefined;
}): Promise<string | null> {
  if (input.multipart.partSize !== input.encryption.chunkSize) {
    throw new Error(
      "Multipart part size must match the encryption chunk size exactly.",
    );
  }
  assertMultipartPlanLimits(input.encryption);
  const status = await resolveMultipartStageStatus({
    apiClient: input.apiClient,
    byteLength: input.encryption.byteLength,
    multipart: input.multipart,
    sha256: input.encryption.sha256,
  });
  // Surface the stage id before any parts upload so the caller can persist it;
  // an upload interrupted mid-flight can then resume this same stage.
  await input.onStageResolved?.({
    partSize: input.encryption.chunkSize,
    stageId: status.stageId,
  });
  if (status.completed) {
    input.onMultipartProgress?.({
      bytesTotal: input.encryption.byteLength,
      bytesUploaded: input.encryption.byteLength,
      partsCompleted: input.encryption.partCount,
      partsTotal: input.encryption.partCount,
    });
    return status.stageId;
  }

  const { completeParts, progress, uploadTasks } = planMultipartParts({
    encryption: input.encryption,
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
    apiClient: input.apiClient,
    completeParts,
    concurrency: normalizeMultipartUploadConcurrency(
      input.multipart.uploadConcurrency,
    ),
    encryption: input.encryption,
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
  if (committedParts.length !== input.encryption.partCount) {
    throw new Error(
      `Multipart blob upload incomplete for stage ${status.stageId}: committed ${committedParts.length.toLocaleString()} of ${input.encryption.partCount.toLocaleString()} parts.`,
    );
  }

  const completed = await input.apiClient.completeMultipartBlobStage(
    status.stageId,
    {
      parts: committedParts,
      uploadId: status.uploadId,
    },
  );
  if (!completed) {
    throw new Error(
      multipartApiFailureMessage({
        apiClient: input.apiClient,
        fallback: `Multipart blob stage completion failed for stage ${status.stageId} with ${committedParts.length.toLocaleString()} committed parts.`,
        request: {
          method: "POST",
          path: `${multipartStagePath(status.stageId)}/complete`,
        },
      }),
    );
  }
  if (
    completed.stageId !== status.stageId ||
    completed.byteLength !== input.encryption.byteLength ||
    completed.sha256 !== input.encryption.sha256
  ) {
    throw new Error(
      `Multipart blob stage ${status.stageId} completion response does not match its request.`,
    );
  }

  return completed.stageId;
}
