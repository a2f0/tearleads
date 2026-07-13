import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";

type DocumentSummarySort = (
  left: DocumentSummary,
  right: DocumentSummary,
) => number;

interface UseDocumentSummariesInput {
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

function mergeDocumentSummary(
  currentDocumentSummaries: ReadonlyArray<DocumentSummary>,
  nextDocumentSummary: DocumentSummary,
  documentKind: StoredDocumentKind | undefined,
): ReadonlyArray<DocumentSummary> {
  if (!documentSummaryMatchesKind(nextDocumentSummary, documentKind)) {
    return currentDocumentSummaries;
  }

  const existingDocumentIndex = currentDocumentSummaries.findIndex(
    (documentSummary) => documentSummary.id === nextDocumentSummary.id,
  );
  return existingDocumentIndex < 0
    ? [...currentDocumentSummaries, nextDocumentSummary]
    : currentDocumentSummaries.map((documentSummary, index) =>
        index === existingDocumentIndex ? nextDocumentSummary : documentSummary,
      );
}

function useDocumentSummaryMutations(input: {
  documentKind: StoredDocumentKind | undefined;
  setSummaries: Dispatch<SetStateAction<ReadonlyArray<DocumentSummary>>>;
}) {
  const { documentKind, setSummaries } = input;

  const mergeSummary = useCallback(
    (nextDocumentSummary: DocumentSummary) => {
      setSummaries((currentDocumentSummaries) =>
        mergeDocumentSummary(
          currentDocumentSummaries,
          nextDocumentSummary,
          documentKind,
        ),
      );
    },
    [documentKind, setSummaries],
  );

  return { mergeSummary };
}

export function useDocumentSummaries({
  documentKind,
  loadErrorMessage,
  sortSummaries,
  subscriptionContainerId,
}: UseDocumentSummariesInput) {
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

  const { mergeSummary } = useDocumentSummaryMutations({
    documentKind,
    setSummaries,
  });

  useEffect(() => {
    if (appData.infra.dbStatus !== "ready") {
      setSummaries([]);
      setReady(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const persistedSummaries = await tearleads.documents.list(
          documentKind === undefined ? {} : { documentKind },
        );

        if (cancelled) {
          return;
        }

        setSummaries(persistedSummaries?.rows ?? []);
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
    tearleads,
  ]);

  useEffect(() => {
    return tearleads.documents.subscribe(mergeSummary, {
      containerId: resolvedSubscriptionContainerId,
    });
  }, [
    appData.state.domainScope,
    mergeSummary,
    resolvedSubscriptionContainerId,
    tearleads,
  ]);

  const sortedSummaries = useMemo(
    () => orderDocumentSummaries(summaries, sortSummaries),
    [summaries, sortSummaries],
  );

  return {
    mergeSummary,
    ready,
    summaries: sortedSummaries,
  };
}
