import {
  type AccessEvent,
  type AttachmentBindAccessEventBody,
  computeAccessEventHash,
  computeBlobContentKeyTargetHash,
} from "@tearleads/crypto";
import type { BlobContentKeyBundleRequest } from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
} from "@tearleads/validators/response";
import { contentKeyTargetReference } from "./readers";
import type { DocumentManifestIdentity } from "./types";

export async function assertBlobContentKeyBundleTargetHash(
  bundle: BlobContentKeyBundleRequest,
): Promise<void> {
  const targetHash = await computeBlobContentKeyTargetHash(
    bundle.targets.map(contentKeyTargetReference),
  );
  if (targetHash !== bundle.targetHash) {
    throw new Error("Blob content-key target hash is not canonical");
  }
}

/**
 * The bind acknowledges by hash: the binding event's hash, the content-key
 * epoch, the write header's hash, and the hashes of the server-resolved KEK
 * target set and blob access manifest must be those of what this client
 * signed. The access manifest hash commits to the blob's organization, active
 * bindings, document manifests, and linked container manifests and KEKs, so
 * matching it proves the server resolved exactly the set this client wrapped
 * its content key to.
 */
export async function assertBlobAttachmentBindResponse(input: {
  bindingId: string;
  blobAccessManifestHash: string;
  blobId: string;
  body: AttachmentBindAccessEventBody;
  contentKeyBundle: BlobContentKeyBundleRequest;
  documentId: string;
  event: AccessEvent;
  manifestIdentity: DocumentManifestIdentity;
  response: BlobAttachmentBindResponse;
  slotId: string;
  targetHash: string;
  writeHeaderHash: string;
}): Promise<void> {
  // This boundary is used only by the staged upload workflow: those bytes were
  // written under the same target set the bind response acknowledges. A future
  // SDK re-bind workflow must instead accept the blob's historical write
  // authorization, which can legitimately differ from the new binding set.
  if (
    input.response.documentManifestHash !==
      input.manifestIdentity.manifestHash ||
    input.response.previousBindingId !== input.body.expectedBindingId ||
    input.response.eventHash !== (await computeAccessEventHash(input.event)) ||
    input.response.contentKeyEpoch !== input.contentKeyBundle.contentKeyEpoch ||
    input.response.blobId !== input.blobId ||
    input.response.bindingId !== input.bindingId ||
    input.response.documentId !== input.documentId ||
    input.response.slotId !== input.slotId ||
    input.response.blobAccessManifestHash !== input.blobAccessManifestHash ||
    input.response.blobKeyTargetHash !== input.targetHash ||
    input.response.writeHeaderHash !== input.writeHeaderHash
  ) {
    throw new Error("Blob attachment bind response did not match request");
  }
}

export function assertBlobAttachmentDetachResponse(input: {
  bindingId: string;
  blobId: string;
  documentId: string;
  response: BlobAttachmentDetachResponse;
  slotId: string;
}): void {
  if (
    input.response.bindingId !== input.bindingId ||
    input.response.blobId !== input.blobId ||
    input.response.documentId !== input.documentId ||
    input.response.slotId !== input.slotId
  ) {
    throw new Error("Blob attachment detach response did not match request");
  }
}
