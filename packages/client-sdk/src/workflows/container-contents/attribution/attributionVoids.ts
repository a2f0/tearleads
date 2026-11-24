import type {
  DocumentEditAttributionRangeResponse,
  DocumentEditAttributionResponse,
  DocumentEditAttributionSegmentResponse,
  ListDocumentEditAttributionRangesResponse,
} from "@tearleads/validators/response";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { readFinalDocumentVoidUpdateIds } from "../../documents/sync/processedCursor";

/** The API's limit on compact segments, past which it truncates. */
const MAX_COMPACT_SEGMENTS = 2_000;
/** The most ranges a page may hold; the API refuses a larger limit. */
const RANGE_PAGE_LIMIT = 500;
/** Where a reader stops paging ranges and reports the list truncated. */
const MAX_RANGES = 20_000;

/** The attribution reads a document's readers make. */
export interface DocumentAttributionApi {
  getDocumentEditAttribution(
    documentId: string,
    requestKey?: string,
  ): Promise<DocumentEditAttributionResponse | null>;
  listDocumentEditAttributionRanges(
    documentId: string,
    options?: {
      readonly cursor?: string | null | undefined;
      readonly expectedRevision?: number | undefined;
      readonly limit?: number | undefined;
    },
  ): Promise<ListDocumentEditAttributionRangesResponse | null>;
}

/**
 * The updates of `documentId` this device voided for good. The API credits
 * each operation to the earliest update whose declared span covers it, and a
 * void update's span is false, so every reader of edit attribution leaves
 * its ranges out: those operations are credited to nobody, not to it. A
 * later update that really carried them is not credited either.
 */
export function readAttributionVoids(
  execSql: ExecSql | null,
  documentId: string,
): Promise<ReadonlySet<string>> {
  return execSql
    ? readFinalDocumentVoidUpdateIds(execSql, documentId)
    : Promise.resolve(new Set());
}

/** `ranges` without those of a void update. */
export function withoutVoidRanges<T extends { readonly updateId: string }>(
  ranges: readonly T[],
  voids: ReadonlySet<string>,
): T[] {
  return voids.size === 0
    ? [...ranges]
    : ranges.filter((range) => !voids.has(range.updateId));
}

function sameAuthority(
  left: DocumentEditAttributionSegmentResponse,
  right: DocumentEditAttributionSegmentResponse,
): boolean {
  return (
    left.peerId === right.peerId &&
    left.writerUserId === right.writerUserId &&
    left.writerKeyFingerprint === right.writerKeyFingerprint &&
    left.authorityKind === right.authorityKind
  );
}

/**
 * Appends one range as the API's compact list does: it extends the last
 * segment when it continues it under the same authority. False when it needs
 * a segment past the limit.
 */
function appendCompactSegment(
  segments: DocumentEditAttributionSegmentResponse[],
  range: DocumentEditAttributionRangeResponse,
): boolean {
  const next: DocumentEditAttributionSegmentResponse = {
    authorityKind: range.authorityKind,
    endCounter: range.endCounter,
    peerId: range.peerId,
    startCounter: range.startCounter,
    writerKeyFingerprint: range.writerKeyFingerprint,
    writerUserId: range.writerUserId,
  };
  const previous = segments.at(-1);
  if (
    previous &&
    previous.endCounter === next.startCounter &&
    sameAuthority(previous, next)
  ) {
    previous.endCounter = next.endCounter;
    return true;
  }
  if (segments.length >= MAX_COMPACT_SEGMENTS) return false;
  segments.push(next);
  return true;
}

/**
 * Compact segments built from every range of one attribution revision but
 * the void ones; null when a page is unavailable.
 */
async function compactRangesWithoutVoids(
  apiClient: DocumentAttributionApi,
  documentId: string,
  voids: ReadonlySet<string>,
): Promise<DocumentEditAttributionResponse | null> {
  const segments: DocumentEditAttributionSegmentResponse[] = [];
  let cursor: string | null = null;
  let revision: number | undefined;
  let read = 0;
  do {
    const page = await apiClient.listDocumentEditAttributionRanges(documentId, {
      cursor,
      expectedRevision: revision,
      limit: RANGE_PAGE_LIMIT,
    });
    if (!page || page.documentId !== documentId) return null;
    revision = page.attributionRevision;
    read += page.items.length;
    const kept = withoutVoidRanges(page.items, voids);
    const complete = kept.every((range) =>
      appendCompactSegment(segments, range),
    );
    if (!complete || (page.hasMore && read >= MAX_RANGES)) {
      return {
        attributionRevision: revision,
        documentId,
        segments,
        truncated: true,
      };
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  return {
    attributionRevision: revision,
    documentId,
    segments,
    truncated: false,
  };
}

/**
 * A document's compact edit attribution as this device reads it. While the
 * device holds none of its updates void, that is the API's compact list;
 * otherwise it is built from the per-upload ranges without the void ones, so
 * contributors, blame, and row writers credit no void update.
 */
export async function loadReaderDocumentEditAttribution(input: {
  readonly apiClient: DocumentAttributionApi;
  readonly documentId: string;
  readonly execSql: ExecSql | null;
  readonly requestKey?: string | undefined;
}): Promise<DocumentEditAttributionResponse | null> {
  const voids = await readAttributionVoids(input.execSql, input.documentId);
  if (voids.size > 0) {
    return compactRangesWithoutVoids(input.apiClient, input.documentId, voids);
  }
  return input.requestKey === undefined
    ? input.apiClient.getDocumentEditAttribution(input.documentId)
    : input.apiClient.getDocumentEditAttribution(
        input.documentId,
        input.requestKey,
      );
}
