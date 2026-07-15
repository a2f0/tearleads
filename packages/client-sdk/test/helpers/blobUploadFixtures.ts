import {
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
} from "@tearleads/crypto";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  DocumentCreateResponse,
} from "@tearleads/validators/response";
import { readWriteHeader } from "../../src/data/documents/shared/readers";

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export async function createBlobAttachmentBindResponse(input: {
  readonly blobId: string;
  readonly documentManifest: DocumentCreateResponse["accessManifest"];
  readonly request: BlobAttachmentBindRequest;
}): Promise<BlobAttachmentBindResponse> {
  const body = input.request.body as Record<string, unknown>;
  const bindingId = String(Reflect.get(body, "bindingId"));
  const documentId = String(Reflect.get(body, "documentId"));
  const slotId = String(Reflect.get(body, "slotId"));
  const organizationId = String(
    Reflect.get(input.documentManifest.state, "organizationId"),
  );
  const targets = input.request.contentKeyBundle.targets.map((target) => ({
    bindingId: target.bindingId,
    containerId: target.containerId,
    containerKeyEpoch: target.containerKeyEpoch,
    containerKeyEpochId: target.containerKeyEpochId,
    containerManifestHash: target.containerManifestHash,
    documentId: target.documentId,
  }));
  const linkedContainerManifestHashes = uniqueSortedStrings(
    targets.map((target) => target.containerManifestHash),
  );
  const linkedContainerKeyEpochIds = uniqueSortedStrings(
    targets.map((target) => target.containerKeyEpochId),
  );
  const blobAccessManifestHash = await computeBlobAccessManifestHash({
    version: 1,
    activeBindingIds: [bindingId],
    blobId: input.blobId,
    blobKeyTargetHash: input.request.contentKeyBundle.targetHash,
    documentManifestHashes: [input.documentManifest.manifestHash],
    linkedContainerKeyEpochIds,
    linkedContainerManifestHashes,
    organizationId,
  });
  const stagedWriteHeader = input.request.stagedBlob?.writeHeader;

  return {
    bindingId,
    blobId: input.blobId,
    documentId,
    slotId,
    blobKekTargets: {
      activeBindingIds: [bindingId],
      blobAccessManifestHash,
      blobId: input.blobId,
      blobKeyTargetHash: input.request.contentKeyBundle.targetHash,
      documentManifestHashes: [input.documentManifest.manifestHash],
      linkedContainerKeyEpochIds,
      linkedContainerManifestHashes,
      organizationId,
      targets,
    },
    contentKeyBundle: {
      blobId: input.blobId,
      ...input.request.contentKeyBundle,
    },
    ...(stagedWriteHeader
      ? {
          writeHeaderHash: await computeWriteHeaderHash(
            readWriteHeader(stagedWriteHeader, "Staged blob write header"),
          ),
        }
      : {}),
  };
}
