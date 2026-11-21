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

/** Every range of a document, as of one attribution revision. */
export interface DocumentAttributionRangesRead {
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
 * Every range of one document, or null when there are too many to read or
 * the read stopped being wanted.
 *
 * - The pages are bound to one attribution revision: a document that gains
 *   an upload mid-read fails the next page rather than mix two histories.
 * - `isCurrent` is asked before each page, so a read nobody is waiting for
 *   stops there.
 * - `held` is what the caller already has for this document. When the first
 *   page shows the same revision and the same first upload, nothing was
 *   uploaded since and `held` is returned as it is: a refresh of an
 *   unchanged document costs one request, not every page.
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
  let revision: number | undefined;
  for (let pages = 0; pages < MAX_RANGE_PAGES && isCurrent(); pages += 1) {
    const page = await containerContents.loadDocumentAttributionRanges({
      cursor,
      documentId,
      expectedRevision: revision,
      limit: RANGE_PAGE_LIMIT,
    });
    if (
      pages === 0 &&
      held !== null &&
      held.revision === page.attributionRevision &&
      held.ranges[0]?.updateId === page.items[0]?.updateId
    ) {
      return held;
    }
    ranges.push(...page.items);
    revision = page.attributionRevision;
    if (!page.hasMore) return { ranges, revision };
    cursor = page.nextCursor;
  }
  return null;
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
