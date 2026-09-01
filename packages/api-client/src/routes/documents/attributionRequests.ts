import {
  getDocumentAttributionOperation,
  isGetDocumentAttributionOperationResponse,
  isListDocumentAttributionRangesOperationResponse,
  listDocumentAttributionRangesOperation,
  operationRequestPath,
  operationRequestPathWithQuery,
} from "@tearleads/validators/operation";
import type {
  DocumentEditAttributionResponse,
  ListDocumentEditAttributionRangesResponse,
} from "@tearleads/validators/response";
import { BoundedCache } from "../../ApiCache";
import { dedupedRequest } from "../../requestInternals";
import type {
  ListDocumentEditAttributionRangesOptions,
  RequestFn,
} from "../../types";

export const getDocumentAttribution = {
  isResponse: isGetDocumentAttributionOperationResponse,
  method: getDocumentAttributionOperation.method,
  path(documentId: string) {
    return operationRequestPath(getDocumentAttributionOperation, {
      documentId,
    });
  },
};

export const listDocumentAttributionRanges = {
  isResponse: isListDocumentAttributionRangesOperationResponse,
  method: listDocumentAttributionRangesOperation.method,
  path(
    documentId: string,
    options: ListDocumentEditAttributionRangesOptions = {},
  ) {
    const { cursor, ...query } = options;
    return operationRequestPathWithQuery(
      listDocumentAttributionRangesOperation,
      { documentId },
      {
        cursor: cursor ?? undefined,
        expectedRevision: query.expectedRevision,
        limit: query.limit,
      },
    );
  },
};

export class DocumentAttributionRequests {
  private readonly compactByGeneration = new BoundedCache<
    Promise<DocumentEditAttributionResponse | null>
  >();
  private readonly generationByDocumentId = new BoundedCache<number>();
  private readonly rangesByPath = new BoundedCache<
    Promise<ListDocumentEditAttributionRangesResponse | null>
  >();
  private nextGeneration = 0;

  constructor(private readonly request: RequestFn) {}

  clear(): void {
    this.compactByGeneration.clear();
    this.generationByDocumentId.clear();
    this.rangesByPath.clear();
  }

  invalidate(documentId: string): void {
    this.generationByDocumentId.set(documentId, ++this.nextGeneration);
  }

  private generation(documentId: string): number {
    const current = this.generationByDocumentId.get(documentId);
    if (current !== undefined) {
      return current;
    }

    const next = ++this.nextGeneration;
    this.generationByDocumentId.set(documentId, next);
    return next;
  }

  get(documentId: string, requestKey = "") {
    return dedupedRequest(
      this.compactByGeneration,
      `${documentId}\u0000${this.generation(documentId)}\u0000${requestKey}`,
      () =>
        this.request(
          getDocumentAttribution.path(documentId),
          getDocumentAttribution.isResponse,
          getDocumentAttribution.method,
        ),
    );
  }

  listRanges(
    documentId: string,
    options: ListDocumentEditAttributionRangesOptions = {},
  ) {
    const path = listDocumentAttributionRanges.path(documentId, options);
    const cacheKey = `${this.generation(documentId)}\u0000${path}`;
    return dedupedRequest(this.rangesByPath, cacheKey, () =>
      this.request(
        path,
        listDocumentAttributionRanges.isResponse,
        listDocumentAttributionRanges.method,
      ),
    );
  }
}
