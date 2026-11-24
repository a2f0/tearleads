import type {
  DocumentAttributionRangesPage,
  Tearleads,
} from "@tearleads/client-sdk";
import type { DocumentEditAttributionRangeResponse } from "@tearleads/validators/response";
import { useCallback } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import {
  type AttributionReadRequest,
  hasAttributionReadSettled,
  heldAttributionResult,
} from "./attributionReadMachine";
import { useDocument } from "./DocumentsProvider";
import {
  type AttributionReadContext,
  useAttributionRead,
  useAttributionRequest,
} from "./useAttributionRead";

/** A document's per-upload attribution: each range names one upload. */
export type DocumentAttributionRanges =
  ReadonlyArray<DocumentEditAttributionRangeResponse>;

/** What reading a document's ranges found. */
export type DocumentAttributionRangesRead =
  | {
      readonly status: "complete";
      /**
       * The update behind the first range, in response order. Two histories
       * at the same revision differ here.
       */
      readonly firstUpdateId: string | null;
      /** Every range. */
      readonly ranges: DocumentAttributionRanges;
      /** The revision every page was read at; it moves with each upload. */
      readonly revision: number;
      /**
       * The updates this device held void, whose ranges the read left out.
       * Voiding one after the read changes what the same revision reads as.
       */
      readonly voidUpdateIds: readonly string[];
    }
  | {
      /**
       * More uploads than a read takes (see `MAX_RANGE_PAGES`), so no ranges.
       * Uploads only ever add ranges, so this stands for the document and
       * session whatever the revision.
       */
      readonly status: "tooMany";
      readonly ranges: DocumentAttributionRanges;
    };

// A stable empty list, so "no ranges" does not churn its readers.
const NO_RANGES: DocumentAttributionRanges = [];

const TOO_MANY: DocumentAttributionRangesRead = {
  ranges: NO_RANGES,
  status: "tooMany",
};

/** The most a page may hold; the API refuses a larger limit. */
const RANGE_PAGE_LIMIT = 500;
/**
 * Where a read gives up: a document with more ranges than this is read as
 * having none at all. Part of the list would date a change from the uploads
 * that happen to be on the pages that were read. It counts ranges, not pages,
 * so a refresh that starts with a probe gives up exactly where a first read
 * does.
 */
const MAX_RANGES = 20_000;
/**
 * The most full pages a read asks for, which bounds a read even if pages
 * come back short: `MAX_RANGES` in pages of `RANGE_PAGE_LIMIT`.
 */
const MAX_RANGE_PAGES = MAX_RANGES / RANGE_PAGE_LIMIT;
/** A refresh's first page only asks whether anything was uploaded since. */
const PROBE_LIMIT = 1;

type ContainerContents = Tearleads["containerContents"];

/** What tells one history of a document from another, and from itself later. */
type AttributionHistory = Pick<
  Extract<DocumentAttributionRangesRead, { status: "complete" }>,
  "firstUpdateId" | "revision" | "voidUpdateIds"
>;

function historyOnPage(
  page: DocumentAttributionRangesPage,
): AttributionHistory {
  return {
    firstUpdateId: page.items[0]?.updateId ?? null,
    revision: page.attributionRevision,
    voidUpdateIds: page.voidUpdateIds,
  };
}

/** Nothing was uploaded, or voided here, since `held` was read. */
function isSameHistory(
  held: AttributionHistory,
  found: AttributionHistory,
): boolean {
  return (
    held.revision === found.revision &&
    held.firstUpdateId === found.firstUpdateId &&
    held.voidUpdateIds.length === found.voidUpdateIds.length &&
    held.voidUpdateIds.every((id, index) => id === found.voidUpdateIds[index])
  );
}

/**
 * Every range of one document, or null when the read stopped being wanted.
 *
 * - The pages are bound to one attribution revision: a document that gains
 *   an upload mid-read fails the next page rather than mix two histories.
 * - `isCurrent` is asked before each page, so a read nobody is waiting for
 *   stops there.
 * - `held` is what the caller already has for this document and session.
 *   A held "too many" stands without a request. A held complete read is
 *   checked with a one-range probe: the same revision, first update, and
 *   void updates mean nothing was uploaded or voided since, and `held` is
 *   returned as it is. Otherwise the read goes on from the probe in full
 *   pages.
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
  if (held?.status === "tooMany") return held;
  const loadPage: LoadRangePage = (cursor, expectedRevision, limit) =>
    containerContents.loadDocumentAttributionRanges({
      cursor,
      documentId,
      expectedRevision,
      limit,
    });
  if (!isCurrent()) return null;
  const probe = held !== null;
  const first = await loadPage(
    null,
    undefined,
    probe ? PROBE_LIMIT : RANGE_PAGE_LIMIT,
  );
  const found = historyOnPage(first);
  if (held !== null && isSameHistory(held, found)) return held;
  const ranges = await readOnFrom(first, {
    fullPagesRead: probe ? 0 : 1,
    isCurrent,
    loadPage,
    revision: found.revision,
  });
  if (ranges === null) return null;
  if (ranges === "tooMany") return TOO_MANY;
  return { ...found, ranges, status: "complete" };
}

type LoadRangePage = (
  cursor: string | null,
  expectedRevision: number | undefined,
  limit: number,
) => Promise<DocumentAttributionRangesPage>;

/**
 * The ranges on `first` and every page after it, each bound to `revision`;
 * "tooMany" past `MAX_RANGES` ranges or `MAX_RANGE_PAGES` full pages, or null
 * once the read is not wanted.
 */
async function readOnFrom(
  first: DocumentAttributionRangesPage,
  read: {
    fullPagesRead: number;
    isCurrent: () => boolean;
    loadPage: LoadRangePage;
    revision: number;
  },
): Promise<DocumentEditAttributionRangeResponse[] | "tooMany" | null> {
  const ranges = [...first.items];
  let page = first;
  let fullPages = read.fullPagesRead;
  while (page.hasMore) {
    // There is at least one range more than those read.
    if (ranges.length >= MAX_RANGES || fullPages >= MAX_RANGE_PAGES) {
      return "tooMany";
    }
    if (!read.isCurrent()) return null;
    page = await read.loadPage(
      page.nextCursor,
      read.revision,
      RANGE_PAGE_LIMIT,
    );
    fullPages += 1;
    ranges.push(...page.items);
  }
  return ranges.length > MAX_RANGES ? "tooMany" : ranges;
}

/**
 * A document's per-upload attribution ranges, for hosts without a
 * DocumentProvider. See `useDocumentAttributionRanges`.
 */
export function useAttributionRangesForDocument(input: {
  documentId: string | null;
  syncing: boolean;
  enabled: boolean;
}): DocumentAttributionRanges | null {
  const { containerContents } = useTearleads();
  const request = useAttributionRequest(input);
  const load = useCallback(
    (
      { documentId }: AttributionReadRequest,
      {
        isCurrent,
        previous,
      }: AttributionReadContext<DocumentAttributionRangesRead>,
    ) =>
      loadAllDocumentAttributionRanges(containerContents, documentId, {
        held: previous,
        isCurrent,
      }),
    [containerContents],
  );
  const state = useAttributionRead(request, load);
  // Nothing to read (offline, unsynced, unauthenticated): no ranges.
  if (request === null) return NO_RANGES;
  // A range never changes once read: an operation's first upload stays its
  // first upload, and later uploads only add ranges. So while a refresh of
  // the same document and session loads, or fails, the ranges already read
  // still say what they said. Dropping them would blank every time they
  // resolve on each sync. Another document or session never sees them.
  const held = heldAttributionResult(state, request);
  if (held !== null) return held.ranges;
  // Nothing held: none once a read in this scope settled, or the first read
  // has yet to say.
  return hasAttributionReadSettled(state, request) ? NO_RANGES : null;
}

/**
 * The open document's per-upload attribution ranges: for each run of
 * operations, the upload that first delivered it and when the server stored
 * that upload. Null until the first read for this document and session
 * settles, so a reader can wait for it rather than show what the ranges
 * would change. Empty when attribution is unavailable (offline, unsynced,
 * unauthenticated, too many to read, or failed). Asked for again after each
 * completed sync, like the compact segments, keeping what is held until the
 * new read is ready and reading every page again only when something was
 * uploaded.
 */
export function useDocumentAttributionRanges(
  enabled: boolean,
): DocumentAttributionRanges | null {
  const { documentId, syncing } = useDocument();
  return useAttributionRangesForDocument({ documentId, syncing, enabled });
}
