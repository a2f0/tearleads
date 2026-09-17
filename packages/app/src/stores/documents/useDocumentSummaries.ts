import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  type DomainScope,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useDeviceFirstContainerContents } from "../device-first/DeviceFirstProvider";
import { subscribeToDocumentSummaryDirectory } from "./documentSummarySubscriptions";
import {
  type ScopedDocumentSummaries,
  useScopedDocumentSummaries,
} from "./useScopedDocumentSummaries";

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

export function mergeDocumentSummary(
  currentDocumentSummaries: ReadonlyArray<DocumentSummary>,
  nextDocumentSummary: DocumentSummary,
  documentKind: StoredDocumentKind | undefined,
): ReadonlyArray<DocumentSummary> {
  if (!documentSummaryMatchesKind(nextDocumentSummary, documentKind)) {
    return currentDocumentSummaries.filter(
      (summary) => summary.id !== nextDocumentSummary.id,
    );
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
  domainScope: DomainScope;
  setSummaryState: Dispatch<SetStateAction<ScopedDocumentSummaries>>;
}) {
  const { documentKind, domainScope, setSummaryState } = input;

  const mergeSummary = useCallback(
    (nextDocumentSummary: DocumentSummary) => {
      setSummaryState((current) => {
        return {
          domainScope,
          ready: current.domainScope === domainScope && current.ready,
          summaries: mergeDocumentSummary(
            current.domainScope === domainScope ? current.summaries : [],
            nextDocumentSummary,
            documentKind,
          ),
        };
      });
    },
    [documentKind, domainScope, setSummaryState],
  );

  return { mergeSummary };
}

function usePersistedDocumentSummaries({
  documentKind,
  domainScope,
  loadErrorMessage,
  mergeSummary,
  setSummaryState,
  subscriptionContainerId,
}: {
  documentKind: StoredDocumentKind | undefined;
  domainScope: DomainScope;
  loadErrorMessage: string;
  mergeSummary: (summary: DocumentSummary) => void;
  subscriptionContainerId: string | null;
  setSummaryState: Dispatch<SetStateAction<ScopedDocumentSummaries>>;
}) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const { view } = useDeviceFirstContainerContents();
  useEffect(() => {
    if (appData.infra.dbStatus !== "ready") {
      setSummaryState({ domainScope, summaries: [], ready: false });
      return;
    }

    return subscribeToDocumentSummaryDirectory({
      isCurrent: () =>
        tearleads.runtime.input().state.domainScope === domainScope,
      load: async () =>
        (
          await tearleads.documents.list(
            documentKind === undefined ? {} : { documentKind },
          )
        )?.rows ?? [],
      onLoaded: (summaries) =>
        setSummaryState({ domainScope, summaries, ready: true }),
      onPersisted: mergeSummary,
      onError: (error) => {
        appData.util.logError(loadErrorMessage, error);
        setSummaryState((current) => ({
          domainScope,
          summaries:
            current.domainScope === domainScope ? current.summaries : [],
          ready: true,
        }));
      },
      subscribePersisted: (listener) =>
        tearleads.documents.subscribe(listener, {
          containerId: subscriptionContainerId,
        }),
      view,
    });
  }, [
    appData.infra.dbStatus,
    appData.util.logError,
    documentKind,
    domainScope,
    loadErrorMessage,
    mergeSummary,
    setSummaryState,
    subscriptionContainerId,
    tearleads,
    view,
  ]);
}

export function useDocumentSummaries({
  documentKind,
  loadErrorMessage,
  sortSummaries,
  subscriptionContainerId,
}: UseDocumentSummariesInput) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const domainScope = appData.state.domainScope;
  const getCurrentScope = useCallback(
    () => tearleads.runtime.input().state.domainScope,
    [tearleads],
  );
  const { summaries, ready, setSummaryState } = useScopedDocumentSummaries(
    domainScope,
    getCurrentScope,
  );
  const resolvedSubscriptionContainerId =
    subscriptionContainerId === undefined
      ? appData.state.containerId
      : subscriptionContainerId;

  const { mergeSummary } = useDocumentSummaryMutations({
    documentKind,
    domainScope,
    setSummaryState,
  });

  usePersistedDocumentSummaries({
    documentKind,
    domainScope,
    loadErrorMessage,
    mergeSummary,
    setSummaryState,
    subscriptionContainerId: resolvedSubscriptionContainerId,
  });

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
