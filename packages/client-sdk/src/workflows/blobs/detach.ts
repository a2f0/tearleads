import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import { signBlobAttachmentDetachEvent } from "../../data/documents/blob/shared/events";
import { deriveBlobTargetsFromDocumentProjection } from "../../data/documents/blob/shared/projection";
import { assertBlobAttachmentDetachResponse } from "../../data/documents/blob/shared/responses";
import type {
  DetachDocumentAttachmentInput,
  DetachDocumentAttachmentResult,
} from "../../data/documents/blob/shared/types";
import { authorizingContainerPathRefs } from "../../data/documents/shared/projection";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { resolveBlobMutationWriterProjection } from "./writerProjection";

export async function detachDocumentAttachment({
  apiClient,
  author,
  bindingId,
  blobId,
  documentId,
  eventId = crypto.randomUUID(),
  execSql,
  isRemoteSyncBlocked,
  resolveProjectionUserKey,
  signedAt = new Date().toISOString(),
  slotId,
  writerProjection,
}: DetachDocumentAttachmentInput): Promise<DetachDocumentAttachmentResult | null> {
  const resolved = await resolveBlobMutationWriterProjection({
    apiClient,
    documentId,
    errorLabel: "Blob attachment detach",
    execSql,
    isRemoteSyncBlocked,
    resolveProjectionUserKey: requireProjectionUserKeyResolver(
      resolveProjectionUserKey,
      "Document attachment detach",
    ),
    writerProjection,
  });
  if (!resolved) {
    return null;
  }
  const { manifestIdentity, writerProjection: resolvedWriterProjection } =
    resolved;

  const targets = deriveBlobTargetsFromDocumentProjection({
    bindingId,
    documentId,
    writerProjection: resolvedWriterProjection,
  });
  const { body, event } = await signBlobAttachmentDetachEvent({
    author,
    bindingId,
    blobId,
    documentId,
    eventId,
    manifestIdentity,
    signedAt,
    slotId,
    targets,
  });
  const request: BlobAttachmentDetachRequest = {
    event: readCanonicalRecord(event, "Blob attachment detach event"),
    body: readCanonicalRecord(body, "Blob attachment detach body"),
    authorizingContainerPathRefs: authorizingContainerPathRefs(
      resolvedWriterProjection,
    ),
  };
  const response = await apiClient.detachBlobAttachment(
    blobId,
    bindingId,
    request,
    {
      expectedPaymentRequiredOrganizationId: manifestIdentity.organizationId,
    },
  );
  if (!response) {
    return null;
  }

  assertBlobAttachmentDetachResponse({
    bindingId,
    blobId,
    documentId,
    response,
    slotId,
  });

  return {
    request,
    response,
    writerProjection: resolvedWriterProjection,
  };
}
