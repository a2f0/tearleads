import {
  createDocumentOperation,
  documentSyncOperation,
  linkDocumentOperation,
  unlinkDocumentOperation,
} from "@tearleads/validators/operation";
import type {
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentPurgeRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  getDocumentPurgeProof as readPurgeProof,
  purgeDocument as submitDocumentPurge,
} from "../documentPurge";
import {
  bindPrototypeMethods,
  evictWriterProjectionIfSyncChanged,
} from "../requestInternals";
import {
  type DocumentPurgeProofOptions,
  documentCreate,
  documentLink,
  documentUnlink,
} from "../routes/documents/mutations";
import type {
  ListDocumentEditAttributionRangesOptions,
  RequestResult,
  RequestResultOptions,
} from "../types";
import type { ApiClientContext } from "./apiClientContext";
import type { ApiClientSelf } from "./apiClientSelf";

/**
 * Document creates, link-set changes, purges, syncs, and edit attribution.
 * Every write invalidates the document's attribution before and after it.
 */
export class DocumentArea {
  private readonly attachmentLists: ApiClientContext["documentAttachmentListRequestsByDocumentId"];
  private readonly projections: ApiClientContext["documentWriterProjectionRequestsByDocumentId"];
  private readonly projectionResults: ApiClientContext["documentWriterProjectionResultsInFlightByDocumentId"];

  constructor(
    private readonly context: ApiClientContext,
    private readonly self: Pick<ApiClientSelf, "evictDocumentWriterProjection">,
  ) {
    bindPrototypeMethods(this, DocumentArea.prototype);
    this.attachmentLists = context.documentAttachmentListRequestsByDocumentId;
    this.projections = context.documentWriterProjectionRequestsByDocumentId;
    this.projectionResults =
      context.documentWriterProjectionResultsInFlightByDocumentId;
  }

  // A link-set write or purge changes the document's placement: its
  // attribution, projection, and attachment envelopes all go stale.
  private placementWrite<T>(
    documentId: string,
    write: () => Promise<T>,
  ): Promise<T> {
    this.context.invalidateDocumentAttribution(documentId);
    return write().finally(() => {
      this.context.invalidateDocumentAttribution(documentId);
      this.self.evictDocumentWriterProjection(documentId);
    });
  }

  // A committed sync drops a changed attachment list and evicts the cached
  // projection only if the sync moved its write material.
  private settleSyncedDocument(
    documentId: string,
    response: DocumentSyncResponse,
  ): Promise<void> {
    if (response.updates.length > 0) {
      this.attachmentLists.delete(documentId);
    }
    return evictWriterProjectionIfSyncChanged(
      this.projections,
      documentId,
      response,
      () => this.projectionResults.delete(documentId),
    );
  }

  // A failed sync leaves its outcome unknown: drop the projection it started
  // against, unless something replaced that entry meanwhile.
  private dropProjectionIfUnchanged(
    documentId: string,
    cachedBefore: Promise<DocumentWriterProjectionResponse | null> | undefined,
  ): void {
    if (this.projections.get(documentId) === cachedBefore) {
      this.projections.delete(documentId);
      this.projectionResults.delete(documentId);
    }
  }

  createDocument(
    input: DocumentCreateRequest,
    options: RequestResultOptions = {},
  ) {
    return this.context.send(
      documentCreate,
      documentCreate.path,
      createDocumentOperation,
      input,
      options,
    );
  }

  createDocumentResult(
    input: DocumentCreateRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentCreateResponse>> {
    return this.context.sendResult(
      documentCreate,
      documentCreate.path,
      createDocumentOperation,
      input,
      options,
    );
  }

  getDocumentEditAttribution(documentId: string, requestKey = "") {
    return this.context.documentAttributionRequests.get(documentId, requestKey);
  }

  listDocumentEditAttributionRanges(
    documentId: string,
    options: ListDocumentEditAttributionRangesOptions = {},
  ) {
    return this.context.documentAttributionRequests.listRanges(
      documentId,
      options,
    );
  }

  linkDocument(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
    options: RequestResultOptions = {},
  ) {
    return this.placementWrite(documentId, () =>
      this.context.send(
        documentLink,
        documentLink.path(documentId),
        linkDocumentOperation,
        input,
        options,
      ),
    );
  }

  linkDocumentResult(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
    options: RequestResultOptions = {},
  ) {
    return this.placementWrite(documentId, () =>
      this.context.sendResult(
        documentLink,
        documentLink.path(documentId),
        linkDocumentOperation,
        input,
        options,
      ),
    );
  }

  unlinkDocument(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
    options: RequestResultOptions = {},
  ) {
    return this.placementWrite(documentId, () =>
      this.context.send(
        documentUnlink,
        documentUnlink.path(documentId),
        unlinkDocumentOperation,
        input,
        options,
      ),
    );
  }

  unlinkDocumentResult(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
    options: RequestResultOptions = {},
  ) {
    return this.placementWrite(documentId, () =>
      this.context.sendResult(
        documentUnlink,
        documentUnlink.path(documentId),
        unlinkDocumentOperation,
        input,
        options,
      ),
    );
  }

  purgeDocument(
    documentId: string,
    input: DocumentPurgeRequest,
    options: RequestResultOptions = {},
  ) {
    return this.placementWrite(documentId, () =>
      submitDocumentPurge(this.context.runtime, documentId, input, options),
    );
  }

  getDocumentPurgeProof(
    documentId: string,
    options?: DocumentPurgeProofOptions,
    requestOptions: RequestResultOptions = {},
  ) {
    return readPurgeProof(
      this.context.runtime,
      documentId,
      options,
      requestOptions,
    );
  }

  syncDocument(
    documentId: string,
    input: DocumentSyncRequest,
    options: RequestResultOptions = {},
  ) {
    this.context.invalidateDocumentAttribution(documentId);
    const cachedBefore = this.projections.get(documentId);
    return this.context.transport
      .request(
        documentSyncOperation,
        {
          body: input,
          params: { documentId },
        },
        options,
      )
      .then(async (response) => {
        if (response) {
          await this.settleSyncedDocument(documentId, response);
        } else {
          this.dropProjectionIfUnchanged(documentId, cachedBefore);
        }
        return response;
      })
      .catch((error: unknown) => {
        this.dropProjectionIfUnchanged(documentId, cachedBefore);
        throw error;
      })
      .finally(() => {
        this.context.invalidateDocumentAttribution(documentId);
      });
  }

  async syncDocumentResult(
    documentId: string,
    input: DocumentSyncRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentSyncResponse>> {
    this.context.invalidateDocumentAttribution(documentId);
    const cachedBefore = this.projections.get(documentId);
    try {
      const result = await this.context.transport.requestResult(
        documentSyncOperation,
        { body: input, params: { documentId } },
        options,
      );
      if (result.ok) {
        await this.settleSyncedDocument(documentId, result.data);
      } else {
        this.dropProjectionIfUnchanged(documentId, cachedBefore);
      }
      return result;
    } finally {
      this.context.invalidateDocumentAttribution(documentId);
    }
  }
}
