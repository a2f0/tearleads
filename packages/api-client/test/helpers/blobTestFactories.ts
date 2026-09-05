import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
} from "@tearleads/validators/request";
import type { BlobAttachmentBindResponse } from "@tearleads/validators/response";

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
    event: {},
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
  const blobKekTargets = {
    activeBindingIds: ["binding-1"],
    blobAccessManifestHash: "blob-manifest-hash",
    blobId: "blob-1",
    blobKeyTargetHash: "blob-target-hash",
    documentManifestHashes: ["blob-manifest-hash"],
    linkedContainerKeyEpochIds: ["container-key-epoch-id"],
    linkedContainerManifestHashes: ["container-manifest-hash"],
    organizationId: "organization-1",
    targets: [],
  };
  return {
    bindingId: "binding-1",
    blobId: "blob-1",
    blobKekTargets,
    bindingEvent: { body: {}, event: {}, eventHash: "binding-event-hash" },
    documentManifestHash: "document-manifest-hash",
    previousBindingId: null,
    writeAuthorization: blobKekTargets,
    writeHeader: {},
    writeHeaderHash: "write-header-hash",
    contentKeyBundle: {
      blobId: "blob-1",
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
    documentId: "document-1",
    slotId: "slot-a",
  };
}
