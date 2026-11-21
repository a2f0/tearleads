import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  BLOB_MUTATION_ERROR_CODES,
  type BlobAttachmentBindResponse,
} from "@tearleads/validators/response";
import type {
  BlobAttachmentApi,
  UploadDocumentAttachmentRequest,
} from "../../../data/blobs/attachments/types";

/**
 * Pulls one upload call makes after binds the API refused for a newer
 * document. Each refusal means another device committed an update inside the
 * uploader's pull-then-bind window; past this many the call returns null and
 * its caller retries later, so a busy document delays a bind but never wedges
 * the uploader.
 */
export const MAX_DOCUMENT_VERSION_REFRESHES = 3;

type PlainBindRequest = Omit<
  BlobAttachmentBindRequest,
  "documentVersionVector"
>;

function bindFailure(apiClient: BlobAttachmentApi, blobId: string) {
  return (
    apiClient.getRequestFailure?.({
      method: "POST",
      path: `/blobs/${encodeURIComponent(blobId)}/attachment-bindings`,
    }) ?? null
  );
}

/** The API refused the bind because the document advanced past its version. */
function bindRefusedForDocumentChange(
  apiClient: BlobAttachmentApi,
  blobId: string,
): boolean {
  const failure = bindFailure(apiClient, blobId);
  return (
    failure?.kind === "http" &&
    failure.status === 409 &&
    failure.code === BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged
  );
}

/**
 * Whether the server refused the bind outright (a client error other than a
 * billing pause, an expired session, or a newer document), which rolled back
 * the binding with the update it carried.
 */
function bindRefusedCarriedSync(
  apiClient: BlobAttachmentApi,
  blobId: string,
): boolean {
  const failure = bindFailure(apiClient, blobId);
  return (
    failure?.kind === "http" &&
    failure.status !== null &&
    [400, 403, 404, 409].includes(failure.status) &&
    failure.code !== BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged
  );
}

interface BindInput {
  readonly apiClient: BlobAttachmentApi;
  readonly blobId: string;
  readonly documentSync: DocumentSyncRequest | undefined;
  readonly organizationId: string;
  readonly plainRequest: BlobAttachmentBindRequest;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly isRemoteSyncBlocked?: UploadDocumentAttachmentRequest["isRemoteSyncBlocked"];
}

interface BindResult {
  readonly request: BlobAttachmentBindRequest;
  readonly response: BlobAttachmentBindResponse | null;
}

/**
 * The carried update adds no failure mode: a refused carry binds once more
 * without it, and the caller's queued row then syncs on its own. A bind
 * refused for a newer document keeps its carry for the next version.
 */
async function bindCarryingDocumentSync(input: BindInput): Promise<BindResult> {
  const canBind = () =>
    input.stillCurrent?.() !== false &&
    !input.isRemoteSyncBlocked?.(input.organizationId);
  const bind = (request: BlobAttachmentBindRequest) =>
    !canBind()
      ? null
      : input.apiClient.bindBlobAttachment(input.blobId, request, {
          expectedPaymentRequiredOrganizationId: input.organizationId,
          stillCurrent: canBind,
        });
  if (input.documentSync) {
    const request = { ...input.plainRequest, documentSync: input.documentSync };
    const response = await bind(request);
    if (response || !bindRefusedCarriedSync(input.apiClient, input.blobId)) {
      return { request, response };
    }
  }
  return {
    request: input.plainRequest,
    response: await bind(input.plainRequest),
  };
}

/**
 * Binds against the document version the caller checked the slot at. When
 * another device committed an update after that check, the API refuses; the
 * caller pulls, checks the slot again, and the same signed bind is retried at
 * the newer version. Only the uploader's own steps are needed to recover.
 */
export async function bindAtVerifiedDocumentVersion(
  input: Omit<BindInput, "plainRequest"> & {
    readonly plainRequest: PlainBindRequest;
    readonly verifiedDocumentVersion: UploadDocumentAttachmentRequest["verifiedDocumentVersion"];
  },
): Promise<BindResult | null> {
  for (let refreshes = 0; ; refreshes += 1) {
    const documentVersionVector = await input.verifiedDocumentVersion({
      refresh: refreshes > 0,
    });
    if (documentVersionVector === null) {
      return null;
    }
    const bound = await bindCarryingDocumentSync({
      ...input,
      plainRequest: { ...input.plainRequest, documentVersionVector },
    });
    if (
      bound.response ||
      refreshes >= MAX_DOCUMENT_VERSION_REFRESHES ||
      !bindRefusedForDocumentChange(input.apiClient, input.blobId)
    ) {
      return bound;
    }
  }
}
