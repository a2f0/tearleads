import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { blobStages } from "../../schema";
import { readMultipartBlobStageRecord } from "../../utils/blobStageRecords";
import { sha256Hex } from "../../utils/sha256";
import {
  type BindBlobAttachmentInput,
  BlobMutationError,
  type DetachBlobAttachmentInput,
  type PrevalidatedMultipartBlobStage,
  runBindBlobAttachmentWorkflow,
  runDetachBlobAttachmentWorkflow,
} from "../../workflows/blobs/mutations";
import type { ApiServiceRuntime } from "../runtime";

export { BlobMutationError } from "../../workflows/blobs/mutations";

const TEXT_ENCODER = new TextEncoder();

async function prevalidateMultipartBlobStage(
  runtime: ApiServiceRuntime,
  input: BindBlobAttachmentInput,
): Promise<PrevalidatedMultipartBlobStage | null> {
  const stagedBlob = input.request.stagedBlob;
  if (!stagedBlob) {
    return null;
  }

  const [stage] = await runtime.db
    .select({
      byteLength: blobStages.byteLength,
      encryptedBytes: blobStages.encryptedBytes,
      expiresAt: blobStages.expiresAt,
      id: blobStages.id,
      ownerUserId: blobStages.ownerUserId,
      sha256: blobStages.sha256,
    })
    .from(blobStages)
    .where(eq(blobStages.id, stagedBlob.stageId))
    .limit(1);

  if (!stage) {
    throw new BlobMutationError("Blob stage not found", 404);
  }
  if (stage.ownerUserId !== input.userId) {
    throw new BlobMutationError("Forbidden", 403);
  }
  if (stage.expiresAt.getTime() <= Date.now()) {
    throw new BlobMutationError("Blob stage has expired", 409);
  }

  const multipartStage = readMultipartBlobStageRecord(stage.encryptedBytes);
  if (!multipartStage) {
    return null;
  }
  if (multipartStage.state !== "complete") {
    throw new BlobMutationError("Blob multipart stage is not complete", 409);
  }

  const encryptedBytes = await runtime.blobObjectStore.getObject(
    multipartStage.storageKey,
  );
  if (encryptedBytes === null) {
    throw new BlobMutationError("Blob staged bytes are missing", 409);
  }
  if (TEXT_ENCODER.encode(encryptedBytes).byteLength !== stage.byteLength) {
    throw new BlobMutationError(
      "Blob byteLength does not match staged bytes",
      409,
    );
  }
  if ((await sha256Hex(encryptedBytes)) !== stage.sha256) {
    throw new BlobMutationError("Blob sha256 does not match staged bytes", 409);
  }

  return {
    byteLength: stage.byteLength,
    sha256: stage.sha256,
    stageId: stage.id,
    storageKey: multipartStage.storageKey,
  };
}

export async function bindBlobAttachment(
  runtime: ApiServiceRuntime,
  input: BindBlobAttachmentInput,
): Promise<BlobAttachmentBindResponse> {
  const prevalidatedMultipartStage = await prevalidateMultipartBlobStage(
    runtime,
    input,
  );

  return runBindBlobAttachmentWorkflow(runtime.db, {
    ...input,
    prevalidatedMultipartStage,
  });
}

export async function detachBlobAttachment(
  runtime: ApiServiceRuntime,
  input: DetachBlobAttachmentInput,
): Promise<BlobAttachmentDetachResponse> {
  return runDetachBlobAttachmentWorkflow(runtime.db, input);
}
