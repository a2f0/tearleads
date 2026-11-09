import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
} from "@tearleads/validators/request";
import {
  type BlobAttachmentBindResponse,
  type BlobAttachmentSummary,
  blobAttachmentSummaryFromStagedBind,
} from "@tearleads/validators/response";

export function createBlobAttachmentBindRequest(): BlobAttachmentBindRequest {
  return {
    authorizingContainerPathRefs: [],
    body: {},
    contentKeyBundle: {
      contentKeyEpoch: 1,
      targetHash: "blob-target-hash",
      targets: [
        {
          bindingId: "binding-1",
          containerId: "container-1",
          containerKeyEpoch: 1,
          containerKeyEpochId: "container-key-epoch-id",
          containerManifestHash: "container-manifest-hash",
          documentId: "document-1",
          wrappedKey: "wrapped-key",
          wrappingMetadata: {},
        },
      ],
    },
    event: { organizationId: "organization-1" },
    stagedBlob: { stageId: "stage-1", writeHeader: {} },
  };
}

export function createBlobAttachmentDetachRequest(): BlobAttachmentDetachRequest {
  return {
    authorizingContainerPathRefs: [],
    body: {},
    event: {},
  };
}

export function createBlobAttachmentBindResponse(): BlobAttachmentBindResponse {
  return {
    bindingId: "binding-1",
    blobAccessManifestHash: "blob-manifest-hash",
    blobId: "blob-1",
    blobKeyTargetHash: "blob-target-hash",
    contentKeyEpoch: 1,
    documentId: "document-1",
    documentManifestHash: "document-manifest-hash",
    eventHash: "binding-event-hash",
    previousBindingId: null,
    slotId: "slot-a",
    writeHeaderHash: "write-header-hash",
  };
}

/** The listing entry the fixture bind commits. */
export function createBlobAttachmentSummary(): BlobAttachmentSummary {
  const request = createBlobAttachmentBindRequest();
  if (!request.stagedBlob) throw new Error("Expected a staged bind request");
  return blobAttachmentSummaryFromStagedBind(
    { ...request, stagedBlob: request.stagedBlob },
    createBlobAttachmentBindResponse(),
  );
}
