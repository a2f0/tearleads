import { blobStages } from "@tearleads/api-shared/schema";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { readMultipartBlobStageRecord } from "../../utils/blobStageRecords";
import { summarizeSha256Stream } from "../../utils/sha256";
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

function listBlobKekTargetContainerIds(
  blobKekTargets: BlobAttachmentBindResponse["blobKekTargets"],
): string[] {
  return [
    ...new Set(
      blobKekTargets.targets
        .flatMap((target) => {
          const containerId = Reflect.get(target, "containerId");
          return typeof containerId === "string" ? [containerId] : [];
        })
        .sort(),
    ),
  ];
}

export function createAttachmentBindDocumentEvent(
  response: Pick<BlobAttachmentBindResponse, "blobKekTargets" | "documentId">,
): Record<string, unknown> {
  return {
    type: "document_update_created",
    containerIds: listBlobKekTargetContainerIds(response.blobKekTargets),
    documentId: response.documentId,
  };
}

async function publishAttachmentBindDocumentEvent(
  runtime: ApiServiceRuntime,
  response: BlobAttachmentBindResponse,
): Promise<void> {
  await runtime.eventPublisher.publish(
    createAttachmentBindDocumentEvent(response),
  );
}

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

  const objectStream = await runtime.blobObjectStore.getObjectStream(
    multipartStage.storageKey,
  );
  if (objectStream === null) {
    throw new BlobMutationError("Blob staged bytes are missing", 409);
  }
  const objectSummary = await summarizeSha256Stream(objectStream);
  if (objectSummary.byteLength !== stage.byteLength) {
    throw new BlobMutationError(
      "Blob byteLength does not match staged bytes",
      409,
    );
  }
  if (objectSummary.sha256 !== stage.sha256) {
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

  const response = await runBindBlobAttachmentWorkflow(runtime.db, {
    ...input,
    prevalidatedMultipartStage,
  });
  await publishAttachmentBindDocumentEvent(runtime, response);
  return response;
}

export async function detachBlobAttachment(
  runtime: ApiServiceRuntime,
  input: DetachBlobAttachmentInput,
): Promise<BlobAttachmentDetachResponse> {
  return runDetachBlobAttachmentWorkflow(runtime.db, input);
}
