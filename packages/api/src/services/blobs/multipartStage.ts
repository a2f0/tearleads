import { blobStages } from "@tearleads/api-shared/schema";
import type { InitiateMultipartBlobStageRequest } from "@tearleads/validators/request";
import type {
  InitiateMultipartBlobStageResponse,
  MultipartBlobStageStatusResponse,
  UploadMultipartBlobPartResponse,
} from "@tearleads/validators/response";
import { MULTIPART_BLOB_STAGE_ERROR_CODES } from "@tearleads/validators/response";
import type { MultipartBlobPartUpload } from "@tearleads/validators/util";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { BlobObjectPart } from "../../adapters/blobObjectStore";
import {
  expireBlobStagesForCleanup,
  type OwnedActiveBlobStage,
} from "../../workflows/blobs/stageAccess";
import {
  persistBlobStageInOrganization,
  requireBlobStageOrganizationAccess,
} from "../../workflows/blobs/stageOrganizationAccess";
import {
  assertBlobStorageKeyOrganization,
  storageKeyForBlobStage,
} from "../../workflows/blobs/storageKeys";
import type { ApiServiceRuntime } from "../runtime";
import {
  assertMultipartPartFitsStage,
  issueMultipartPartUpload,
} from "./multipartPartUpload";
import {
  type AuthenticatedMultipartBlobStageInput,
  assertUploadIdMatches,
  loadMultipartBlobStage,
  MultipartBlobStageError,
  toMultipartBlobStageError,
} from "./multipartStageAccess";
import { recoverAssembledMultipartStage } from "./multipartStageCompletion";

export { MultipartBlobStageError } from "./multipartStageAccess";

export interface CleanupExpiredBlobStagesInput {
  readonly organizationId?: string;
  readonly limit?: number | undefined;
  readonly now?: Date | undefined;
}

interface CleanupExpiredBlobStagesResult {
  readonly abortedMultipartUploads: number;
  readonly deletedMultipartObjects: number;
  readonly deletedStages: number;
  readonly failedStages: number;
  readonly failures: readonly unknown[];
  readonly scannedStages: number;
}

interface UploadMultipartBlobPartInput
  extends AuthenticatedMultipartBlobStageInput {
  readonly byteLength: number;
  readonly bytes: Uint8Array;
  readonly partNumber: number;
  readonly sha256: string;
  readonly uploadId: string;
}

function normalizeCleanupLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 100;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new MultipartBlobStageError(
      "Blob stage cleanup limit must be a positive integer",
      400,
    );
  }

  return limit;
}

async function listStageParts(
  runtime: ApiServiceRuntime,
  stage: OwnedActiveBlobStage,
) {
  if (stage.completedAt !== null) {
    const object = await runtime.blobObjectStore.getObjectStream(
      stage.storageKey,
    );
    if (!object) {
      throw new MultipartBlobStageError(
        "Completed multipart object not found",
        404,
        MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
      );
    }
    await object.cancel();
    return [];
  }

  return runtime.blobObjectStore.listParts({
    key: stage.storageKey,
    uploadId: stage.uploadId,
  });
}

export async function cleanupExpiredBlobStages(
  runtime: ApiServiceRuntime,
  input: CleanupExpiredBlobStagesInput = {},
  hooks?: { readonly assertObjectDeletionLease: () => Promise<void> },
): Promise<CleanupExpiredBlobStagesResult> {
  const now = input.now ?? new Date();
  const limit = normalizeCleanupLimit(input.limit);
  const stages = await runtime.db
    .select({
      id: blobStages.id,
    })
    .from(blobStages)
    .where(
      and(
        lte(blobStages.expiresAt, now),
        input.organizationId === undefined
          ? undefined
          : eq(blobStages.organizationId, input.organizationId),
      ),
    )
    .limit(limit);
  let abortedMultipartUploads = 0;
  let deletedMultipartObjects = 0;
  let deletedStages = 0;
  const failures: unknown[] = [];
  const cleanedStageIds: string[] = [];

  let claimed: readonly OwnedActiveBlobStage[] = [];
  if (stages.length > 0) {
    try {
      await hooks?.assertObjectDeletionLease();
      claimed = await expireBlobStagesForCleanup(runtime.db, {
        now,
        stageIds: stages.map((candidate) => candidate.id),
      });
    } catch (error) {
      // Nothing was claimed: every candidate stays expired and is retried.
      failures.push(...stages.map(() => error));
    }
  }

  for (const stage of claimed) {
    try {
      assertBlobStorageKeyOrganization(stage.storageKey, stage.organizationId);
      if (stage.completedAt === null) {
        await runtime.blobObjectStore.abortMultipartUpload({
          key: stage.storageKey,
          uploadId: stage.uploadId,
        });
        abortedMultipartUploads += 1;
        // A bind may have assembled the object before its row flip, so the
        // abort finds no upload. A claimed stage can no longer be promoted,
        // so nothing else owns its key.
        await runtime.blobObjectStore.deleteObject(stage.storageKey);
      } else {
        await runtime.blobObjectStore.deleteObject(stage.storageKey);
        deletedMultipartObjects += 1;
      }
      cleanedStageIds.push(stage.id);
    } catch (error) {
      failures.push(error);
    }
  }

  if (cleanedStageIds.length > 0) {
    const deletedRows = await runtime.db
      .delete(blobStages)
      .where(inArray(blobStages.id, cleanedStageIds))
      .returning({ id: blobStages.id });
    deletedStages = deletedRows.length;
  }

  return {
    abortedMultipartUploads,
    deletedMultipartObjects,
    deletedStages,
    failedStages: failures.length,
    failures,
    scannedStages: stages.length,
  };
}

// The parts a client sends first must be distinct parts the declared object
// can hold, checked before the upload exists so no capability is ever issued
// for a part the stage could not complete with.
function assertFirstPartsFitStage(
  runtime: ApiServiceRuntime,
  input: InitiateMultipartBlobStageRequest,
): void {
  const partNumbers = new Set<number>();
  let byteLength = 0;
  for (const part of input.firstParts) {
    assertMultipartPartFitsStage(runtime, input.byteLength, part);
    partNumbers.add(part.partNumber);
    byteLength += part.byteLength;
  }
  if (
    partNumbers.size !== input.firstParts.length ||
    byteLength > input.byteLength
  ) {
    throw new MultipartBlobStageError("Invalid multipart part", 400);
  }
}

export async function initiateMultipartBlobStage(
  runtime: ApiServiceRuntime,
  input: InitiateMultipartBlobStageRequest & { readonly userId: string },
): Promise<InitiateMultipartBlobStageResponse> {
  const { organizationId } = input;
  await requireBlobStageOrganizationAccess(
    runtime.db,
    input,
    (message, status) => new MultipartBlobStageError(message, status),
  );
  assertFirstPartsFitStage(runtime, input);
  const stageId = crypto.randomUUID();
  const storageKey = storageKeyForBlobStage(organizationId, stageId);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  try {
    const upload = await runtime.blobObjectStore.createMultipartUpload({
      key: storageKey,
    });

    let partUploads: MultipartBlobPartUpload[];
    try {
      // The first parts' upload sources ride on this response, so the parts
      // the client starts at once need no authorization round trip of their
      // own. They are issued before the stage row exists, so a signing
      // failure leaves no row behind for the upload to outlive.
      const stage = { expiresAt, storageKey, uploadId: upload.uploadId };
      partUploads = await Promise.all(
        input.firstParts.map((part) =>
          issueMultipartPartUpload(runtime, stage, part),
        ),
      );
      await persistBlobStageInOrganization(
        runtime.db,
        {
          id: stageId,
          ownerUserId: input.userId,
          organizationId,
          storageKey,
          uploadId: upload.uploadId,
          byteLength: input.byteLength,
          sha256: input.sha256,
          expiresAt,
        },
        (message, status) => new MultipartBlobStageError(message, status),
      );
    } catch (error) {
      // Without the stage row, expiry cleanup cannot discover this upload.
      // Abort it best-effort and preserve the original failure.
      await runtime.blobObjectStore
        .abortMultipartUpload({ key: storageKey, uploadId: upload.uploadId })
        .catch(() => {});
      throw error;
    }

    return {
      organizationId,
      byteLength: input.byteLength,
      expiresAt: expiresAt.toISOString(),
      partUploads,
      sha256: input.sha256,
      stageId,
      uploadId: upload.uploadId,
      uploadedParts: [],
    };
  } catch (error) {
    const multipartError = toMultipartBlobStageError(error);
    if (multipartError) {
      throw multipartError;
    }
    throw error;
  }
}

export async function getMultipartBlobStage(
  runtime: ApiServiceRuntime,
  input: AuthenticatedMultipartBlobStageInput,
): Promise<MultipartBlobStageStatusResponse> {
  try {
    const stage = await loadMultipartBlobStage(runtime, input);
    let completed = stage.completedAt !== null;
    let uploadedParts: readonly BlobObjectPart[];
    try {
      uploadedParts = await listStageParts(runtime, stage);
    } catch (error) {
      await recoverAssembledMultipartStage(runtime, stage, error);
      completed = true;
      uploadedParts = [];
    }

    return {
      organizationId: stage.organizationId,
      byteLength: stage.byteLength,
      completed,
      expiresAt: stage.expiresAt.toISOString(),
      sha256: stage.sha256,
      stageId: stage.id,
      uploadId: stage.uploadId,
      uploadedParts: [...uploadedParts],
    };
  } catch (error) {
    const multipartError = toMultipartBlobStageError(error);
    if (multipartError) {
      throw multipartError;
    }
    throw error;
  }
}

export async function uploadMultipartBlobPartBytes(
  runtime: ApiServiceRuntime,
  input: UploadMultipartBlobPartInput,
): Promise<UploadMultipartBlobPartResponse> {
  if (runtime.blobObjectStore.createUploadPartUrl) {
    throw new MultipartBlobStageError(
      "Direct multipart uploads are required",
      409,
    );
  }
  try {
    const stage = await loadMultipartBlobStage(runtime, input);
    if (stage.completedAt !== null) {
      throw new MultipartBlobStageError(
        "Blob multipart stage is complete",
        409,
      );
    }
    assertUploadIdMatches({
      expectedUploadId: stage.uploadId,
      uploadId: input.uploadId,
    });

    const part = await runtime.blobObjectStore.uploadPart({
      body: {
        byteLength: input.byteLength,
        bytes: input.bytes,
        sha256: input.sha256,
      },
      key: stage.storageKey,
      partNumber: input.partNumber,
      uploadId: stage.uploadId,
    });

    return {
      part,
      stageId: stage.id,
      uploadId: stage.uploadId,
    };
  } catch (error) {
    const multipartError = toMultipartBlobStageError(error);
    if (multipartError) {
      throw multipartError;
    }
    throw error;
  }
}
