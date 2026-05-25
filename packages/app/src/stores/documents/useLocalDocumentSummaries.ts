import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useState } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";

type DocumentSummarySort = (
  left: DocumentSummary,
  right: DocumentSummary,
) => number;

interface UseLocalDocumentSummariesInput {
  documentKind?: StoredDocumentKind | undefined;
  loadErrorMessage: string;
  sortSummaries?: DocumentSummarySort | undefined;
  subscriptionContainerId?: string | null | undefined;
}

function documentSummaryMatchesKind(
  documentSummary: DocumentSummary,
  documentKind: StoredDocumentKind | undefined,
): boolean {
  return (
    documentKind === undefined ||
    (documentSummary.documentKind ?? DEFAULT_DOCUMENT_KIND) === documentKind
  );
}

function orderDocumentSummaries(
  documentSummaries: ReadonlyArray<DocumentSummary>,
  sortSummaries: DocumentSummarySort | undefined,
): DocumentSummary[] {
  const nextDocumentSummaries = Array.from(documentSummaries);
  return sortSummaries
    ? nextDocumentSummaries.sort(sortSummaries)
    : nextDocumentSummaries;
}

function mergeLocalDocumentSummary(
  currentDocumentSummaries: ReadonlyArray<DocumentSummary>,
  nextDocumentSummary: DocumentSummary,
  input: Pick<UseLocalDocumentSummariesInput, "documentKind" | "sortSummaries">,
): ReadonlyArray<DocumentSummary> {
  if (!documentSummaryMatchesKind(nextDocumentSummary, input.documentKind)) {
    return currentDocumentSummaries;
  }

  const existingDocumentIndex = currentDocumentSummaries.findIndex(
    (documentSummary) => documentSummary.id === nextDocumentSummary.id,
  );
  const nextDocumentSummaries =
    existingDocumentIndex < 0
      ? [...currentDocumentSummaries, nextDocumentSummary]
      : currentDocumentSummaries.map((documentSummary, index) =>
          index === existingDocumentIndex
            ? nextDocumentSummary
            : documentSummary,
        );

  return orderDocumentSummaries(nextDocumentSummaries, input.sortSummaries);
}

export function useLocalDocumentSummaries({
  documentKind,
  loadErrorMessage,
  sortSummaries,
  subscriptionContainerId,
}: UseLocalDocumentSummariesInput) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const [summaries, setSummaries] = useState<ReadonlyArray<DocumentSummary>>(
    [],
  );
  const [ready, setReady] = useState(false);
  const resolvedSubscriptionContainerId =
    subscriptionContainerId === undefined
      ? appData.state.containerId
      : subscriptionContainerId;

  const mergeSummary = useCallback(
    (nextDocumentSummary: DocumentSummary) => {
      setSummaries((currentDocumentSummaries) =>
        mergeLocalDocumentSummary(
          currentDocumentSummaries,
          nextDocumentSummary,
          {
            documentKind,
            sortSummaries,
          },
        ),
      );
    },
    [documentKind, sortSummaries],
  );

  useEffect(() => {
    if (appData.infra.dbStatus !== "ready") {
      setSummaries([]);
      setReady(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const persistedSummaries =
          (await tearleads.documents.listLocalSummaries(
            documentKind === undefined ? {} : { documentKind },
          )) ?? [];
        const nextSummaries = orderDocumentSummaries(
          persistedSummaries,
          sortSummaries,
        );

        if (cancelled) {
          return;
        }

        setSummaries(nextSummaries);
        setReady(true);
      } catch (error) {
        if (!cancelled) {
          appData.util.logError(loadErrorMessage, error);
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    appData.infra.dbStatus,
    appData.state.domainScope,
    appData.util.logError,
    documentKind,
    loadErrorMessage,
    sortSummaries,
    tearleads,
  ]);

  useEffect(() => {
    return tearleads.documents.subscribeToLocalSummaries(mergeSummary, {
      containerId: resolvedSubscriptionContainerId,
    });
  }, [
    appData.state.domainScope,
    mergeSummary,
    resolvedSubscriptionContainerId,
    tearleads,
  ]);

  return {
    mergeSummary,
    ready,
    summaries,
  };
}
