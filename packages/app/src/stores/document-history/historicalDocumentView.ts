import type {
  DocumentHistoryView,
  DocumentSnapshot,
  DocumentStore,
} from "@tearleads/client-sdk";
import { createContext, useLayoutEffect, useMemo, useRef } from "react";
import {
  createHistoricalDocumentStore,
  type HistoricalDocumentStore,
  historicalDocumentSnapshot,
} from "./historicalDocumentStore";

/**
 * The past version a host wants documents beneath it to show, or null for the
 * live document. `DocumentsProvider` reads it: it still opens the live store,
 * then serves its children this version read-only.
 */
export const DocumentHistoryViewContext =
  createContext<DocumentHistoryView | null>(null);

/**
 * The read-only store for a past version of a live document. One store lives
 * as long as the caller and is updated in place, so stepping through history
 * re-renders the document instead of remounting it.
 */
export function useHistoricalDocumentStore(
  live: DocumentSnapshot,
  view: DocumentHistoryView,
): DocumentStore {
  const snapshot = useMemo(
    () => historicalDocumentSnapshot(live, view),
    [live, view],
  );
  const historical = useRef<HistoricalDocumentStore | null>(null);
  if (historical.current === null) {
    historical.current = createHistoricalDocumentStore(snapshot);
  }
  const { current } = historical;
  // Before paint, so a step never shows one frame of the previous version.
  useLayoutEffect(() => {
    current.show(snapshot);
  }, [current, snapshot]);

  return current.store;
}
