import type {
  DocumentEditAttributionRangeResponse,
  ListDocumentEditAttributionRangesResponse,
} from "@tearleads/validators/response";

export interface DocumentAttributionRangesInput {
  readonly cursor?: string | null | undefined;
  readonly documentId: string;
  readonly expectedRevision?: number | undefined;
  readonly limit?: number | undefined;
}

export interface DocumentAttributionRangesPage {
  readonly attributionRevision: number;
  readonly documentId: string;
  readonly hasMore: boolean;
  readonly items: DocumentEditAttributionRangeResponse[];
  readonly nextCursor: string | null;
}

interface DocumentAttributionRangesApi {
  listDocumentEditAttributionRanges(
    documentId: string,
    options?: {
      readonly cursor?: string | null | undefined;
      readonly expectedRevision?: number | undefined;
      readonly limit?: number | undefined;
    },
  ): Promise<ListDocumentEditAttributionRangesResponse | null>;
}

export async function loadDocumentAttributionRanges(input: {
  readonly apiClient: DocumentAttributionRangesApi;
  readonly query: DocumentAttributionRangesInput;
}): Promise<DocumentAttributionRangesPage> {
  const page = await input.apiClient.listDocumentEditAttributionRanges(
    input.query.documentId,
    {
      cursor: input.query.cursor,
      expectedRevision: input.query.expectedRevision,
      limit: input.query.limit,
    },
  );
  if (!page) {
    throw new Error(
      `Edit attribution ranges were unavailable for document ${input.query.documentId}.`,
    );
  }
  if (page.documentId !== input.query.documentId) {
    throw new Error(
      `Edit attribution ranges belonged to document ${page.documentId}, not ${input.query.documentId}.`,
    );
  }
  return page;
}
