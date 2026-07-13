import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { signBlobAttachmentDetachEvent } from "../../data/documents/blob/shared/events";
import { deriveBlobTargetsFromDocumentProjection } from "../../data/documents/blob/shared/projection";
import { readDocumentManifestIdentity } from "../../data/documents/blob/shared/readers";
import { assertBlobAttachmentDetachResponse } from "../../data/documents/blob/shared/responses";
import type {
  DetachDocumentAttachmentInput,
  DetachDocumentAttachmentResult,
} from "../../data/documents/blob/shared/types";
import {
  assertDocumentWriterProjectionConsistent,
  authorizingContainerPathRefs,
} from "../../data/documents/shared/projection";
import {
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
} from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

async function loadDetachWriterProjection(
  input: {
    apiClient: DetachDocumentAttachmentInput["apiClient"];
    documentId: string;
    execSql?: ExecSql | undefined;
    writerProjection?: DocumentWriterProjectionResponse | undefined;
  } & ProjectionVerificationOptions,
): Promise<DocumentWriterProjectionResponse | null> {
  const writerProjection =
    input.writerProjection ??
    (await input.apiClient.getDocumentWriterProjection(input.documentId));
  if (!writerProjection) {
    return null;
  }

  await assertDocumentWriterProjectionConsistent(writerProjection, {
    execSql: input.execSql,
    ...projectionVerificationOptions(input),
  });

  return writerProjection;
}

function blobAttachmentDetachRequest(input: {
  body: ReturnType<typeof readCanonicalRecord>;
  event: ReturnType<typeof readCanonicalRecord>;
  writerProjection: DocumentWriterProjectionResponse;
}): BlobAttachmentDetachRequest {
  return {
    event: input.event,
    body: input.body,
    authorizingContainerPathRefs: authorizingContainerPathRefs(
      input.writerProjection,
    ),
  };
}

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
  const resolvedWriterProjection = await loadDetachWriterProjection({
    apiClient,
    documentId,
    execSql,
    resolveProjectionUserKey: requireProjectionUserKeyResolver(
      resolveProjectionUserKey,
      "Document attachment detach",
    ),
    writerProjection,
  });
  if (!resolvedWriterProjection) {
    return null;
  }

  const manifestIdentity = readDocumentManifestIdentity(
    resolvedWriterProjection,
  );
  if (manifestIdentity.documentId !== documentId) {
    throw new Error(
      "Blob attachment detach writer projection targets wrong document",
    );
  }
  if (isRemoteSyncBlocked?.(manifestIdentity.organizationId)) {
    return null;
  }

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
  const request = blobAttachmentDetachRequest({
    body: readCanonicalRecord(body, "Blob attachment detach body"),
    event: readCanonicalRecord(event, "Blob attachment detach event"),
    writerProjection: resolvedWriterProjection,
  });
  const response = await apiClient.detachBlobAttachment(
    blobId,
    bindingId,
    request,
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
