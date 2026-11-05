import {
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
  getMultipartBlobStageOperation,
  initiateMultipartBlobStageOperation,
  listDocumentAttachmentsOperation,
} from "@tearleads/validators/operation";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  InitiateMultipartBlobStageRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import { blobAttachmentSummaryFromStagedBind } from "@tearleads/validators/response";
import { bindPrototypeMethods, cachedRequest } from "../requestInternals";
import {
  bindBlobAttachment as blobAttachmentBind,
  detachBlobAttachment as blobAttachmentDetach,
} from "../routes/blobs/attachments";
import {
  getBlobBytes,
  type UploadMultipartBlobPartBytesRequest,
} from "../routes/blobs/get";
import {
  getMultipartBlobStage as multipartGet,
  initiateMultipartBlobStage as multipartInitiate,
} from "../routes/blobs/multipart";
import { uploadMultipartBlobPartBytes } from "../routes/blobs/multipartUpload";
import { listDocumentAttachments as documentAttachmentsList } from "../routes/documents/attachments";
import type { RequestResultOptions } from "../types";
import type { ApiClientContext } from "./apiClientContext";

type AttachmentList = ListDocumentAttachmentsResponse;

/**
 * Multipart blob staging, blob bytes, and document attachment bindings, with
 * the per-document attachment listing cache they keep current.
 */
export class BlobArea {
  private readonly attachmentLists: ApiClientContext["documentAttachmentListRequestsByDocumentId"];

  constructor(private readonly context: ApiClientContext) {
    bindPrototypeMethods(this, BlobArea.prototype);
    this.attachmentLists = context.documentAttachmentListRequestsByDocumentId;
  }

  private updateCachedDocumentAttachmentList(
    documentId: string,
    update: (attachments: AttachmentList) => AttachmentList,
  ): void {
    const cached = this.attachmentLists.get(documentId);
    if (!cached) {
      return;
    }

    let next: Promise<AttachmentList | null>;
    next = cached
      .then((attachments) => {
        if (!attachments) {
          if (this.attachmentLists.get(documentId) === next) {
            this.attachmentLists.delete(documentId);
          }
          return attachments;
        }

        return update(attachments);
      })
      .catch(() => {
        // The underlying list fetch failed. Drop this derived cache entry so the
        // next read refetches, and resolve to null (the cache's miss semantics)
        // rather than rethrowing: nothing awaits this derived promise directly,
        // so a rethrow would surface as an unhandled rejection. Callers already
        // awaiting the original request still observe its rejection.
        if (this.attachmentLists.get(documentId) === next) {
          this.attachmentLists.delete(documentId);
        }
        return null;
      });
    this.attachmentLists.set(documentId, next);
  }

  /**
   * The bind acknowledges by hash, so the cached listing entry is rebuilt
   * from the request it acknowledged: a staged upload's bind stores exactly
   * the signed event, content-key bundle, and write header it carried, with
   * the resolved KEK targets as its write authorization. Any other bind (no
   * staged blob, or a blob other bindings share) keeps material the response
   * does not carry, so it drops the cached listing instead.
   */
  private cacheBlobAttachmentBindResponse(
    request: BlobAttachmentBindRequest,
    response: BlobAttachmentBindResponse,
  ): void {
    const { stagedBlob } = request;
    const activeBindingIds = response.blobKekTargets.activeBindingIds;
    if (
      !stagedBlob ||
      activeBindingIds.length !== 1 ||
      activeBindingIds[0] !== response.bindingId
    ) {
      this.attachmentLists.delete(response.documentId);
      return;
    }
    const binding = blobAttachmentSummaryFromStagedBind(
      { ...request, stagedBlob },
      response,
    );
    this.updateCachedDocumentAttachmentList(
      response.documentId,
      (attachments) => [
        ...attachments.filter(
          (cachedBinding) => cachedBinding.slotId !== response.slotId,
        ),
        binding,
      ],
    );
  }

  private cacheBlobAttachmentDetachResponse(
    response: BlobAttachmentDetachResponse,
  ): void {
    this.updateCachedDocumentAttachmentList(
      response.documentId,
      (attachments) =>
        attachments.filter(
          (binding) => binding.bindingId !== response.bindingId,
        ),
    );
  }

  // An attachment write updates the cached listing from its response; a
  // refused or failed write leaves every listing unknown, so all are dropped.
  private attachmentWrite<R>(
    write: Promise<R | null>,
    cacheResponse: (response: R) => void,
  ): Promise<R | null> {
    return write
      .then((response) => {
        if (response) {
          cacheResponse(response);
        } else {
          this.attachmentLists.clear();
        }
        return response;
      })
      .catch((error: unknown) => {
        this.attachmentLists.clear();
        throw error;
      });
  }

  initiateMultipartBlobStage(input: InitiateMultipartBlobStageRequest) {
    return this.context.send(
      multipartInitiate,
      multipartInitiate.path,
      initiateMultipartBlobStageOperation,
      input,
    );
  }

  getMultipartBlobStage(stageId: string) {
    return this.context.send(
      multipartGet,
      multipartGet.path(stageId),
      getMultipartBlobStageOperation,
    );
  }

  uploadMultipartBlobPartBytes(
    stageId: string,
    partNumber: number,
    input: UploadMultipartBlobPartBytesRequest,
    options: RequestResultOptions = {},
  ) {
    return uploadMultipartBlobPartBytes(
      this.context.transport,
      stageId,
      partNumber,
      input,
      undefined,
      options,
    );
  }

  getBlobBytes(blobId: string, options: RequestResultOptions = {}) {
    return getBlobBytes(this.context.transport, blobId, undefined, options);
  }

  bindBlobAttachment(
    blobId: string,
    input: BlobAttachmentBindRequest,
    options: RequestResultOptions = {},
  ) {
    return this.attachmentWrite(
      this.context.send(
        blobAttachmentBind,
        blobAttachmentBind.path(blobId),
        bindBlobAttachmentOperation,
        input,
        options,
      ),
      (response) => this.cacheBlobAttachmentBindResponse(input, response),
    );
  }

  detachBlobAttachment(
    blobId: string,
    bindingId: string,
    input: BlobAttachmentDetachRequest,
    options: RequestResultOptions = {},
  ) {
    return this.attachmentWrite(
      this.context.send(
        blobAttachmentDetach,
        blobAttachmentDetach.path(blobId, bindingId),
        detachBlobAttachmentOperation,
        input,
        options,
      ),
      this.cacheBlobAttachmentDetachResponse,
    );
  }

  listDocumentAttachments(
    documentId: string,
    options: { refresh?: boolean } = {},
  ) {
    if (options.refresh) {
      this.attachmentLists.delete(documentId);
    }
    return cachedRequest(this.attachmentLists, documentId, () =>
      this.context.send(
        documentAttachmentsList,
        documentAttachmentsList.path(documentId),
        listDocumentAttachmentsOperation,
      ),
    );
  }
}
