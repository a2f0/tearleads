import type { DocumentSummary, DomainScope } from "@tearleads/client-sdk";
import { type SetStateAction, useCallback, useState } from "react";

export interface ScopedDocumentSummaries {
  domainScope: DomainScope;
  ready: boolean;
  summaries: ReadonlyArray<DocumentSummary>;
}

const EMPTY_SUMMARIES: ReadonlyArray<DocumentSummary> = [];

export function useScopedDocumentSummaries(
  domainScope: DomainScope,
  getCurrentScope: () => DomainScope,
) {
  const [stored, setStored] = useState<ScopedDocumentSummaries>({
    domainScope,
    ready: false,
    summaries: EMPTY_SUMMARIES,
  });
  const setSummaryState = useCallback(
    (update: SetStateAction<ScopedDocumentSummaries>) => {
      setStored((current) => {
        if (getCurrentScope() !== domainScope) return current;
        return typeof update === "function" ? update(current) : update;
      });
    },
    [domainScope, getCurrentScope],
  );
  // Identity changes render before load effects and their cleanup. Neither old
  // rows nor delayed old-scope callbacks may reach the new content demand.
  return {
    ready: stored.domainScope === domainScope && stored.ready,
    setSummaryState,
    summaries:
      stored.domainScope === domainScope ? stored.summaries : EMPTY_SUMMARIES,
  };
}
