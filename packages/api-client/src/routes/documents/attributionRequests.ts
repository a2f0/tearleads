import {
  getDocumentAttributionOperation,
  listDocumentAttributionRangesOperation,
} from "@tearleads/validators/operation";
import type {
  DocumentEditAttributionResponse,
  ListDocumentEditAttributionRangesResponse,
} from "@tearleads/validators/response";
import { BoundedCache } from "../../ApiCache";
import {
  deriveJsonOperationRequest,
  type JsonOperationTransport,
} from "../../operationTransport";
import { dedupedRequest } from "../../requestInternals";
import type { ListDocumentEditAttributionRangesOptions } from "../../types";

export class DocumentAttributionRequests {
  private readonly compactByGeneration = new BoundedCache<
    Promise<DocumentEditAttributionResponse | null>
  >();
  private readonly generationByDocumentId = new BoundedCache<number>();
  private readonly rangesByPath = new BoundedCache<
    Promise<ListDocumentEditAttributionRangesResponse | null>
  >();
  private nextGeneration = 0;

  constructor(private readonly transport: JsonOperationTransport) {}

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
      async () => {
        const response = await this.transport.requestResponse(
          getDocumentAttributionOperation,
          { headers: {}, params: { documentId } },
        );
        return response?.status === 200 ? response.data : null;
      },
    );
  }

  listRanges(
    documentId: string,
    options: ListDocumentEditAttributionRangesOptions = {},
  ) {
    const input = {
      headers: {},
      params: { documentId },
      query: {
        cursor: options.cursor ?? undefined,
        expectedRevision: options.expectedRevision,
        limit: options.limit,
      },
    };
    const path = deriveJsonOperationRequest(
      listDocumentAttributionRangesOperation,
      input,
    ).path;
    const cacheKey = `${this.generation(documentId)}\u0000${path}`;
    return dedupedRequest(this.rangesByPath, cacheKey, () =>
      this.transport.request(listDocumentAttributionRangesOperation, input),
    );
  }
}
