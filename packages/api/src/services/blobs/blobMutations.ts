import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
} from "@tearleads/validators/response";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import { uniqueSortedStrings } from "../../utils/array";
import { publishBestEffort } from "../../utils/publishBestEffort";
import {
  type BindBlobAttachmentInput,
  BlobMutationError,
  type DetachBlobAttachmentInput,
  type PrevalidatedMultipartBlobStage,
  runBindBlobAttachmentWorkflow,
  runDetachBlobAttachmentWorkflow,
} from "../../workflows/blobs/mutations";
import { loadOwnedActiveBlobStage } from "../../workflows/blobs/stageAccess";
import type { ApiServiceRuntime } from "../runtime";
import {
  createDeferredEnvelopeReader,
  summarizeBlobEnvelopeStage,
} from "./blobEnvelopeStage";
import {
  MultipartBlobStageError,
  toMultipartBlobStageError,
} from "./multipartStageAccess";
import { completeOwnedMultipartStage } from "./multipartStageCompletion";

export { BlobMutationError } from "../../workflows/blobs/mutations";

type AttachmentMutationOrigin = {
  readonly sessionId: string;
  readonly userId: string;
};

function listBlobKekTargetContainerIds(
  blobKekTargets: BlobAttachmentBindResponse["blobKekTargets"],
): string[] {
  const targets = Array.isArray(blobKekTargets?.targets)
    ? blobKekTargets.targets
    : [];
  const containerIds = targets.flatMap((target) => {
    const containerId =
      typeof target === "object" && target !== null
        ? Reflect.get(target, "containerId")
        : null;
    return typeof containerId === "string" ? [containerId] : [];
  });

  return uniqueSortedStrings(containerIds);
}

export function createAttachmentBindDocumentEvent(
  response: Pick<
    BlobAttachmentBindResponse,
    "blobKekTargets" | "documentId" | "documentSync"
  >,
  origin: AttachmentMutationOrigin,
): PublishedRealtimeEvent {
  const updateIds = response.documentSync?.acceptedOutgoingUpdateIds;
  return {
    type: "document_update_created",
    containerIds: listBlobKekTargetContainerIds(response.blobKekTargets),
    documentId: response.documentId,
    // A carried document sync names its update, as a sync's event does.
    ...(updateIds ? { updateIds: [...updateIds] } : {}),
    // Tag the authoring session so the ws router does not echo this bind back
    // over the author's own socket, the same way document sync events are
    // tagged (routes/documents/mutations.ts). The router strips `origin` before
    // forwarding, so it never reaches any client. A peer still receives the
    // event (no updateIds) and correctly treats it as a lossy hint to pull.
    origin,
  };
}

export function createAttachmentDetachDocumentEvent(input: {
  readonly containerIds: readonly string[];
  readonly origin: AttachmentMutationOrigin;
  readonly response: Pick<BlobAttachmentDetachResponse, "documentId">;
}): PublishedRealtimeEvent {
  return {
    type: "document_update_created",
    containerIds: uniqueSortedStrings(input.containerIds),
    documentId: input.response.documentId,
    origin: input.origin,
  };
}

export async function publishAttachmentDocumentEvent(input: {
  readonly event: PublishedRealtimeEvent;
  readonly publish: ApiServiceRuntime["eventPublisher"]["publish"];
}): Promise<void> {
  await publishBestEffort(
    input.publish,
    input.event,
    "attachment document event",
  );
}

// Binding completes the stage: the parts the store holds are assembled and the
// object's exact length and SHA-256 verified against the stage before anything
// is promoted. A refusal keeps its status; an unexpected failure propagates.
async function completeStagedUpload(
  runtime: ApiServiceRuntime,
  stage: Parameters<typeof completeOwnedMultipartStage>[1],
  reader: Parameters<typeof completeOwnedMultipartStage>[2],
): ReturnType<typeof completeOwnedMultipartStage> {
  try {
    return await completeOwnedMultipartStage(runtime, stage, reader);
  } catch (error) {
    const stageError =
      error instanceof MultipartBlobStageError
        ? error
        : toMultipartBlobStageError(error);
    if (stageError === null || stageError.status === 500) {
      throw error;
    }
    throw new BlobMutationError(stageError.message, stageError.status);
  }
}

// One read of the object per bind: the completion that assembles it digests
// it while the envelope header is observed, so only a stage completed by an
// earlier bind is read here.
async function readStagedEnvelope(
  runtime: ApiServiceRuntime,
  stage: Parameters<typeof completeOwnedMultipartStage>[1],
) {
  const envelope = createDeferredEnvelopeReader();
  const assembled = await completeStagedUpload(runtime, stage, envelope);
  if (assembled !== null) {
    return { ...assembled, envelopeHeader: envelope.judge(assembled) };
  }
  const objectStream = await runtime.blobObjectStore.getObjectStream(
    stage.storageKey,
  );
  if (objectStream === null) {
    throw new BlobMutationError("Blob staged bytes are missing", 409);
  }
  return summarizeBlobEnvelopeStage(objectStream);
}

async function prevalidateMultipartBlobStage(
  runtime: ApiServiceRuntime,
  input: BindBlobAttachmentInput,
): Promise<PrevalidatedMultipartBlobStage | null> {
  const stagedBlob = input.request.stagedBlob;
  if (!stagedBlob) {
    return null;
  }

  const stage = await loadOwnedActiveBlobStage(runtime.db, {
    error: (message, status) => new BlobMutationError(message, status),
    stageId: stagedBlob.stageId,
    userId: input.userId,
  });

  const objectSummary = await readStagedEnvelope(runtime, stage);
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
    envelopeHeader: objectSummary.envelopeHeader,
    sha256: stage.sha256,
    stageId: stage.id,
    storageKey: stage.storageKey,
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
  await publishAttachmentDocumentEvent({
    event: createAttachmentBindDocumentEvent(response, {
      sessionId: input.sessionId,
      userId: input.userId,
    }),
    publish: runtime.eventPublisher.publish,
  });
  return response;
}

export async function detachBlobAttachment(
  runtime: ApiServiceRuntime,
  input: DetachBlobAttachmentInput,
): Promise<BlobAttachmentDetachResponse> {
  const result = await runDetachBlobAttachmentWorkflow(runtime.db, input);
  await publishAttachmentDocumentEvent({
    event: createAttachmentDetachDocumentEvent({
      containerIds: result.linkedContainerIds,
      origin: { sessionId: input.sessionId, userId: input.userId },
      response: result.response,
    }),
    publish: runtime.eventPublisher.publish,
  });
  return result.response;
}
