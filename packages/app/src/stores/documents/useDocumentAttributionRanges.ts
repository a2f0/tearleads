import type { Tearleads } from "@tearleads/client-sdk";
import type { DocumentEditAttributionRangeResponse } from "@tearleads/validators/response";
import { useCallback, useEffect, useRef } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "./DocumentsProvider";
import {
  type AttributionRequest,
  useAttributionRead,
  useAttributionRequest,
} from "./useDocumentRowWriters";

/** A document's per-upload attribution: each range names one upload. */
export type DocumentAttributionRanges =
  ReadonlyArray<DocumentEditAttributionRangeResponse>;

/** What reading a document's ranges found, as of one attribution revision. */
export interface DocumentAttributionRangesRead {
  /** The document's first upload, which tells one history from another. */
  readonly firstUpdateId: string | null;
  /**
   * Every range, or none when the document has more uploads than a read
   * takes: see `MAX_RANGE_PAGES`.
   */
  readonly ranges: DocumentAttributionRanges;
  /** The revision every page was read at; it moves with each upload. */
  readonly revision: number;
}

// A stable empty list, so "no ranges" does not churn its readers.
const NO_RANGES: DocumentAttributionRanges = [];

/** The most a page may hold; the API refuses a larger limit. */
const RANGE_PAGE_LIMIT = 500;
/**
 * Where a read gives up. A document with more uploads than this is read as
 * having no ranges at all: part of the list would date a change from the
 * uploads that happen to be on the pages that were read.
 */
const MAX_RANGE_PAGES = 40;

type ContainerContents = Tearleads["containerContents"];

/**
 * Every range of one document, or null when the read stopped being wanted.
 *
 * - The pages are bound to one attribution revision: a document that gains
 *   an upload mid-read fails the next page rather than mix two histories.
 * - `isCurrent` is asked before each page, so a read nobody is waiting for
 *   stops there.
 * - A document with more uploads than `MAX_RANGE_PAGES` holds is read as
 *   having no ranges, at that revision.
 * - `held` is what the caller already has for this document. When the first
 *   page shows the same revision and the same first upload, nothing was
 *   uploaded since and `held` is returned as it is: a refresh of an
 *   unchanged document costs one request, not every page, and not forty for
 *   a document already found to have too many.
 */
export async function loadAllDocumentAttributionRanges(
  containerContents: Pick<ContainerContents, "loadDocumentAttributionRanges">,
  documentId: string,
  options: {
    held?: DocumentAttributionRangesRead | null | undefined;
    isCurrent?: (() => boolean) | undefined;
  } = {},
): Promise<DocumentAttributionRangesRead | null> {
  const { held = null, isCurrent = () => true } = options;
  const ranges: DocumentEditAttributionRangeResponse[] = [];
  let cursor: string | null = null;
  let found: Pick<
    DocumentAttributionRangesRead,
    "firstUpdateId" | "revision"
  > | null = null;
  for (let pages = 0; pages < MAX_RANGE_PAGES; pages += 1) {
    if (!isCurrent()) return null;
    const page = await containerContents.loadDocumentAttributionRanges({
      cursor,
      documentId,
      expectedRevision: found?.revision,
      limit: RANGE_PAGE_LIMIT,
    });
    if (found === null) {
      found = {
        firstUpdateId: page.items[0]?.updateId ?? null,
        revision: page.attributionRevision,
      };
      if (
        held !== null &&
        held.revision === found.revision &&
        held.firstUpdateId === found.firstUpdateId
      ) {
        return held;
      }
    }
    ranges.push(...page.items);
    if (!page.hasMore) return { ...found, ranges };
    cursor = page.nextCursor;
  }
  // Too many uploads to read. Say so as a read of its own, so an unchanged
  // document is not paged through again after every sync.
  return found === null ? null : { ...found, ranges: NO_RANGES };
}

/**
 * A document's per-upload attribution ranges, for hosts without a
 * DocumentProvider. See `useDocumentAttributionRanges`.
 */
export function useAttributionRangesForDocument(input: {
  documentId: string | null;
  syncing: boolean;
  enabled: boolean;
}): DocumentAttributionRanges {
  const { containerContents } = useTearleads();
  const request = useAttributionRequest(input);

  // A range never changes once read: an operation's first upload stays its
  // first upload, and later uploads only add ranges. So while a refresh of
  // the same document and session loads, or fails, the ranges already held
  // still say what they said. Dropping them would blank every time they
  // resolve on each sync. Another document or session never sees them.
  const held = useRef<{
    read: DocumentAttributionRangesRead;
    scope: object;
  } | null>(null);
  const load = useCallback(
    ({ documentId, scope }: AttributionRequest, isCurrent: () => boolean) =>
      loadAllDocumentAttributionRanges(containerContents, documentId, {
        held: held.current?.scope === scope ? held.current.read : null,
        isCurrent,
      }),
    [containerContents],
  );
  const read = useAttributionRead(request, load);
  const scope = request?.scope ?? null;
  useEffect(() => {
    if (read !== null && scope !== null) held.current = { read, scope };
  }, [read, scope]);
  if (read !== null) return read.ranges;
  return scope !== null && held.current?.scope === scope
    ? held.current.read.ranges
    : NO_RANGES;
}

/**
 * The open document's per-upload attribution ranges: for each run of
 * operations, the upload that first delivered it and when the server stored
 * that upload. Empty while they first load and when attribution is
 * unavailable (offline, unsynced, unauthenticated, too many to read, or
 * changed mid-read). Asked for again after each completed sync, like the
 * compact segments, keeping what is held until the new read is ready and
 * reading every page again only when something was uploaded.
 */
export function useDocumentAttributionRanges(
  enabled: boolean,
): DocumentAttributionRanges {
  const { documentId, syncing } = useDocument();
  return useAttributionRangesForDocument({ documentId, syncing, enabled });
}
