import type { DocumentEditAttributionRangeResponse } from "@tearleads/validators/response";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type DocumentAttributionApi,
  readAttributionVoids,
  withoutVoidRanges,
} from "./attributionVoids";

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

/**
 * One page of a document's per-upload ranges as this device reads it: the
 * ranges of the updates it voided for good are left out (see
 * `readAttributionVoids`), so a page may hold fewer than it asked for, or
 * none while more follow.
 */
export async function loadDocumentAttributionRanges(input: {
  readonly apiClient: Pick<
    DocumentAttributionApi,
    "listDocumentEditAttributionRanges"
  >;
  readonly execSql: ExecSql | null;
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
  const voids = await readAttributionVoids(
    input.execSql,
    input.query.documentId,
  );
  return { ...page, items: withoutVoidRanges(page.items, voids) };
}
