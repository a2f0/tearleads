import { MAX_BLOB_CHUNK_COUNT } from "@tearleads/crypto";
import type { MultipartBlobStagePart } from "@tearleads/validators/response";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "@tearleads/validators/util";
import {
  BLOB_TRANSFER_CONCURRENCY,
  runBlobTransfer,
} from "../../data/blobs/transferPool";
import type { BlobEncryptionPlan } from "../../data/documents/blob/shared/crypto";
import type {
  BlobAttachmentApi,
  MultipartStageResolvedListener,
  MultipartUploadProgressListener,
  UploadDocumentAttachmentInput,
} from "../../data/documents/blob/shared/types";
import {
  type MultipartPartSources,
  type PreparedFirstPart,
  type PreparedMultipartPart,
  releasePreparedParts,
  sha256BytesHex,
  takePartSource,
} from "./multipartFirstParts";
import {
  multipartApiFailureMessage,
  multipartStagePath,
} from "./multipartStageFailures";
import { resolveMultipartStage } from "./multipartStageResolution";

const DEFAULT_MULTIPART_UPLOAD_CONCURRENCY = 4;
const MAX_MULTIPART_UPLOAD_CONCURRENCY = 4;
// Fetch exposes no upload progress on every host. Allow a slow shared uplink
// (8 KiB/s total, shared by every admitted part), plus setup/encryption time.
const MULTIPART_TRANSFER_BYTES_PER_SECOND = 8 * 1024;

interface MultipartPartCommit {
  readonly etag: string;
  readonly partNumber: number;
}

interface MultipartPartUploadTask {
  readonly byteLength: number;
  readonly partIndex: number;
  readonly partNumber: number;
}

function pathSegment(value: number | string): string {
  return encodeURIComponent(String(value));
}

function multipartPartRequest(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly partNumber: number;
  readonly stageId: string;
}) {
  const basePath = `${multipartStagePath(input.stageId)}/parts/${pathSegment(input.partNumber)}`;
  const authorization = { method: "POST" as const, path: `${basePath}/upload` };
  // A successful authorization clears its previous failure. If a memory-store
  // byte request then fails, its separate transport diagnostic is authoritative.
  return input.apiClient.getRequestFailure?.(authorization)
    ? authorization
    : { method: "PUT" as const, path: `${basePath}/bytes` };
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
  readonly prepared: Map<number, PreparedFirstPart>;
  readonly sources: MultipartPartSources;
  readonly stageId: string;
  readonly tasks: readonly MultipartPartUploadTask[];
  readonly uploadId: string;
}): Promise<void> {
  let failed = false;
  let firstFailure: { readonly error: unknown } | undefined;
  let nextTaskIndex = 0;
  const recordFailure = (error: unknown) => {
    failed = true;
    firstFailure ??= { error };
  };

  async function worker(): Promise<void> {
    while (!failed) {
      const task = input.tasks[nextTaskIndex];
      nextTaskIndex += 1;
      if (!task) {
        return;
      }

      try {
        // A first part already holds the pool slot its prepared bytes use.
        const heldPermit = input.prepared.get(task.partIndex)?.permit;
        await runBlobTransfer(
          input.apiClient,
          async (signal) => {
            if (failed) return;
            const aborted = () => recordFailure(signal.reason);
            signal.addEventListener("abort", aborted, { once: true });
            try {
              const uploaded = await uploadMultipartPartBytes({
                apiClient: input.apiClient,
                encryption: input.encryption,
                prepared: input.prepared,
                sources: input.sources,
                stageId: input.stageId,
                task,
                uploadId: input.uploadId,
                signal,
              });
              signal.throwIfAborted();
              if (!uploaded) {
                failed = true;
                throw new Error(
                  multipartApiFailureMessage({
                    apiClient: input.apiClient,
                    fallback: `Multipart blob part ${task.partNumber} upload failed for stage ${input.stageId}.`,
                    request: multipartPartRequest({
                      apiClient: input.apiClient,
                      partNumber: task.partNumber,
                      stageId: input.stageId,
                    }),
                  }),
                );
              }

              input.completeParts[task.partIndex] = {
                etag: uploaded.part.etag,
                partNumber: task.partNumber,
              };
              input.onPartUploaded?.(task);
            } catch (error) {
              // Publish failure before releasing the permit to a queued sibling.
              // Already-started parts still record success and drain through the join.
              recordFailure(error);
            } finally {
              signal.removeEventListener("abort", aborted);
            }
          },
          120_000 +
            Math.ceil(
              (task.byteLength * BLOB_TRANSFER_CONCURRENCY * 1000) /
                MULTIPART_TRANSFER_BYTES_PER_SECOND,
            ),
          heldPermit,
        );
      } catch (error) {
        recordFailure(error);
      }
    }
  }

  const workerCount = Math.min(input.concurrency, input.tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstFailure) {
    throw firstFailure.error;
  }
}

// A first part was encrypted once before the stage existed; hand its bytes
// over (and release them) instead of encrypting it again.
async function encryptedPart(input: {
  readonly encryption: BlobEncryptionPlan;
  readonly prepared: Map<number, PreparedFirstPart>;
  readonly task: MultipartPartUploadTask;
}): Promise<PreparedMultipartPart> {
  const prepared = input.prepared.get(input.task.partIndex);
  if (prepared) {
    input.prepared.delete(input.task.partIndex);
    return prepared;
  }
  const bytes = await input.encryption.encryptPart(input.task.partIndex);
  if (bytes.byteLength !== input.task.byteLength) {
    throw new Error(
      `Encrypted blob part ${input.task.partNumber} byte length mismatch: expected ${input.task.byteLength.toLocaleString()}, received ${bytes.byteLength.toLocaleString()}.`,
    );
  }
  return { bytes, sha256: await sha256BytesHex(bytes) };
}

async function uploadMultipartPartBytes(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly encryption: BlobEncryptionPlan;
  readonly prepared: Map<number, PreparedFirstPart>;
  readonly sources: MultipartPartSources;
  readonly stageId: string;
  readonly task: MultipartPartUploadTask;
  readonly uploadId: string;
  readonly signal: AbortSignal;
}): ReturnType<BlobAttachmentApi["uploadMultipartBlobPartBytes"]> {
  input.signal.throwIfAborted();
  const { bytes: encryptedPartBytes, sha256 } = await encryptedPart(input);
  input.signal.throwIfAborted();
  const source = takePartSource(input.sources, input.task.partNumber);
  const uploaded = await input.apiClient.uploadMultipartBlobPartBytes(
    input.stageId,
    input.task.partNumber,
    {
      byteLength: encryptedPartBytes.byteLength,
      encryptedBytes: encryptedPartBytes,
      sha256,
      ...(source === undefined ? {} : { source }),
      uploadId: input.uploadId,
    },
    { signal: input.signal },
  );
  input.signal.throwIfAborted();
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

function assertMultipartPlanLimits(encryption: BlobEncryptionPlan): void {
  if (encryption.partCount > MAX_BLOB_CHUNK_COUNT) {
    throw new Error(
      `Multipart blob upload would require ${encryption.partCount.toLocaleString()} parts; the maximum is ${MAX_BLOB_CHUNK_COUNT.toLocaleString()} parts.`,
    );
  }
  for (let index = 0; index < encryption.partCount; index += 1) {
    if (encryption.getPartByteLength(index) > MAX_MULTIPART_BLOB_PART_BYTES) {
      throw new Error(
        `Encrypted blob part ${index + 1} exceeds the 32 MiB multipart part limit.`,
      );
    }
  }
}

type StageMultipartBlobAttachmentInput = {
  readonly apiClient: BlobAttachmentApi;
  readonly encryption: BlobEncryptionPlan;
  readonly multipart: NonNullable<UploadDocumentAttachmentInput["multipart"]>;
  readonly organizationId: string;
  readonly onMultipartProgress?: MultipartUploadProgressListener | undefined;
  readonly onStageResolved?: MultipartStageResolvedListener | undefined;
  readonly onStageUnavailable?:
    | ((stageId: string) => Promise<void>)
    | undefined;
};

export async function stageMultipartBlobAttachment(
  input: StageMultipartBlobAttachmentInput,
): Promise<string | null> {
  if (input.multipart.partSize !== input.encryption.chunkSize) {
    throw new Error(
      "Multipart part size must match the encryption chunk size exactly.",
    );
  }
  assertMultipartPlanLimits(input.encryption);
  const concurrency = normalizeMultipartUploadConcurrency(
    input.multipart.uploadConcurrency,
  );
  const resolved = await resolveMultipartStage({
    apiClient: input.apiClient,
    concurrency,
    encryption: input.encryption,
    multipart: input.multipart,
    organizationId: input.organizationId,
    onStageUnavailable: input.onStageUnavailable,
  });
  try {
    return await uploadResolvedMultipartStage(input, concurrency, resolved);
  } finally {
    // First parts no worker consumed (an early failure) return their slots.
    releasePreparedParts(resolved.prepared);
  }
}

async function uploadResolvedMultipartStage(
  input: StageMultipartBlobAttachmentInput,
  concurrency: number,
  {
    prepared,
    sources,
    status,
  }: Awaited<ReturnType<typeof resolveMultipartStage>>,
): Promise<string> {
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
    concurrency,
    encryption: input.encryption,
    onPartUploaded: (task) => {
      progress.partsCompleted += 1;
      progress.bytesUploaded += task.byteLength;
      reportMultipartProgress();
    },
    prepared,
    sources,
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

  // Binding the attachment completes the stage: the API assembles these parts
  // and verifies the object's length and SHA-256 before promoting it.
  return status.stageId;
}
