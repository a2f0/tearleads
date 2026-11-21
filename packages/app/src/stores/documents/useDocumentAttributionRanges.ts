import type { Tearleads } from "@tearleads/client-sdk";
import type { DocumentEditAttributionRangeResponse } from "@tearleads/validators/response";
import { useEffect, useReducer } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "./DocumentsProvider";
import {
  type RowWritersEvent,
  type RowWritersRequest,
  type RowWritersState,
  transitionRowWriters,
} from "./rowWritersMachine";
import { useAttributionRequest } from "./useDocumentRowWriters";

/** A document's per-upload attribution: each range names one upload. */
export type DocumentAttributionRanges =
  ReadonlyArray<DocumentEditAttributionRangeResponse>;

// A stable empty list, so "no ranges" does not churn its readers.
const NO_RANGES: DocumentAttributionRanges = [];

/** The most a page may hold; the API refuses a larger limit. */
const RANGE_PAGE_LIMIT = 500;
/**
 * Where a read gives up. A document with more uploads than this is read as
 * having no ranges at all: part of the list would credit or date a change
 * from uploads that happen to be on the pages that were read.
 */
const MAX_RANGE_PAGES = 40;

type ContainerContents = Tearleads["containerContents"];

/**
 * Every range of one document, or null when there are too many to read. The
 * pages are bound to one attribution revision: a document that gains an
 * upload mid-read fails the next page rather than mix two histories.
 */
export async function loadAllDocumentAttributionRanges(
  containerContents: Pick<ContainerContents, "loadDocumentAttributionRanges">,
  documentId: string,
): Promise<DocumentAttributionRanges | null> {
  const ranges: DocumentEditAttributionRangeResponse[] = [];
  let cursor: string | null = null;
  let expectedRevision: number | undefined;
  for (let pages = 0; pages < MAX_RANGE_PAGES; pages += 1) {
    const page = await containerContents.loadDocumentAttributionRanges({
      cursor,
      documentId,
      expectedRevision,
      limit: RANGE_PAGE_LIMIT,
    });
    ranges.push(...page.items);
    if (!page.hasMore) return ranges;
    cursor = page.nextCursor;
    expectedRevision = page.attributionRevision;
  }
  return null;
}

type RangesState = RowWritersState<DocumentAttributionRanges>;
type RangesEvent = RowWritersEvent<DocumentAttributionRanges>;

function transitionRanges(state: RangesState, event: RangesEvent): RangesState {
  return transitionRowWriters<DocumentAttributionRanges>(state, event);
}

function useAttributionRanges(
  request: RowWritersRequest | null,
  containerContents: ContainerContents,
): DocumentAttributionRanges {
  const [state, dispatch] = useReducer(transitionRanges, { status: "idle" });
  useEffect(() => dispatch({ type: "request", request }), [request]);
  const loading = state.status === "loading" ? state.request : null;
  useEffect(() => {
    if (!loading || loading !== request) return;
    let active = true;
    void loadAllDocumentAttributionRanges(
      containerContents,
      loading.documentId,
    ).then(
      (ranges) => {
        if (!active) return;
        dispatch(
          ranges === null
            ? { type: "failed", request: loading }
            : { type: "loaded", request: loading, segments: ranges },
        );
      },
      () => {
        if (active) dispatch({ type: "failed", request: loading });
      },
    );
    return () => {
      active = false;
    };
  }, [containerContents, loading, request]);
  // Effects clear state after commit; projection must already hide an old
  // document's ranges during the very first render of the new scope.
  return state.status === "ready" && state.request === request
    ? state.segments
    : NO_RANGES;
}

/**
 * The open document's per-upload attribution ranges: who first uploaded each
 * run of operations, and when the server stored that upload. Empty while they
 * load and when attribution is unavailable (offline, unsynced,
 * unauthenticated, too many to read, or changed mid-read). Read again after
 * each completed sync, like the compact segments.
 */
export function useDocumentAttributionRanges(
  enabled: boolean,
): DocumentAttributionRanges {
  const { documentId, syncing } = useDocument();
  const { containerContents } = useTearleads();
  const request = useAttributionRequest({ documentId, syncing, enabled });
  return useAttributionRanges(request, containerContents);
}
