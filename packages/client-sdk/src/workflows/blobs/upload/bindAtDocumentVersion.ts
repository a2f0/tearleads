import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type { BlobAttachmentBindResponse } from "@tearleads/validators/response";
import { isAttachmentDocumentChanged } from "../../../data/blobs/attachments/responses";
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

/**
 * Why the API refused a bind this call sent: the document advanced past its
 * version (pull and retry), the request was refused outright (a client error
 * other than a billing pause or an expired session, which rolled back the
 * binding with the update it carried), or anything else.
 */
type BindRefusal = "documentChanged" | "refused" | "other";

function classifyBindRefusal(
  failure: ReturnType<typeof bindFailure>,
): BindRefusal {
  if (failure?.kind !== "http" || failure.status === null) return "other";
  if (isAttachmentDocumentChanged(failure)) return "documentChanged";
  return [400, 403, 404, 409].includes(failure.status) ? "refused" : "other";
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

interface BindAttempt {
  readonly request: BlobAttachmentBindRequest;
  readonly response: BlobAttachmentBindResponse | null;
  /** Why the request this attempt sent was refused; null when none was. */
  readonly refusal: BindRefusal | null;
}

/** How one upload call's binds ended; the first matching status wins. */
export type DocumentVersionBindEnd =
  | {
      readonly status: "bound";
      readonly request: BlobAttachmentBindRequest;
      readonly response: BlobAttachmentBindResponse;
    }
  /**
   * The caller's check returned null instead of a version: the slot no
   * longer asks for the bytes, or the caller's pull did not complete.
   */
  | { readonly status: "abandoned" }
  /** The last bind was refused because the document advanced again. */
  | { readonly status: "documentChanged" }
  /** The last bind failed for another reason, or was not sent. */
  | { readonly status: "failed" };

export type DocumentVersionBindStatus = DocumentVersionBindEnd["status"];

/**
 * The carried update adds no failure mode: a refused carry binds once more
 * without it, and the caller's queued row then syncs on its own. A bind
 * refused for a newer document keeps its carry for the next version. A
 * refusal is read only from a request this attempt sent, never from an
 * earlier request's recorded failure.
 */
async function bindCarryingDocumentSync(
  input: BindInput,
): Promise<BindAttempt> {
  const canBind = () =>
    input.stillCurrent?.() !== false &&
    !input.isRemoteSyncBlocked?.(input.organizationId);
  const bind = async (
    request: BlobAttachmentBindRequest,
  ): Promise<BindAttempt> => {
    if (!canBind()) return { refusal: null, request, response: null };
    // The client records each failure as a new object and keeps it until a
    // success, so an unchanged record means this request recorded none: it
    // was retired (as during session renewal) or never sent.
    const earlier = bindFailure(input.apiClient, input.blobId);
    const response = await input.apiClient.bindBlobAttachment(
      input.blobId,
      request,
      {
        expectedPaymentRequiredOrganizationId: input.organizationId,
        reportErrors: false,
        stillCurrent: canBind,
      },
    );
    const recorded = bindFailure(input.apiClient, input.blobId);
    const failure = response || recorded === earlier ? null : recorded;
    // A refusal for a newer document is routine on a busy document and is
    // retried; every other recorded failure is still reported. Turning the
    // client's reporting off also drops its own "Session refresh failed"
    // diagnostic for a renewal that fails during a bind, which `report`
    // does not replay.
    if (failure && classifyBindRefusal(failure) !== "documentChanged") {
      failure.report?.();
    }
    return {
      refusal: failure && canBind() ? classifyBindRefusal(failure) : null,
      request,
      response,
    };
  };
  if (input.documentSync) {
    const carried = await bind({
      ...input.plainRequest,
      documentSync: input.documentSync,
    });
    if (carried.refusal !== "refused") return carried;
  }
  return bind(input.plainRequest);
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
): Promise<DocumentVersionBindEnd> {
  for (let refreshes = 0; ; refreshes += 1) {
    const documentVersionVector = await input.verifiedDocumentVersion({
      refresh: refreshes > 0,
    });
    if (documentVersionVector === null) return { status: "abandoned" };
    const { refusal, request, response } = await bindCarryingDocumentSync({
      ...input,
      plainRequest: { ...input.plainRequest, documentVersionVector },
    });
    if (response) return { request, response, status: "bound" };
    if (refusal !== "documentChanged") return { status: "failed" };
    if (refreshes >= MAX_DOCUMENT_VERSION_REFRESHES) {
      return { status: "documentChanged" };
    }
  }
}
