import type {
  ContainerDocumentQueries,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeSnapshot } from "../../providers/sdk/TearleadsProvider";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import {
  mergeDocumentSummaryLists,
  mergeSingleDocumentSummaryList,
} from "./documentSummaryUtils";

export function useExplorerDocumentSummaryState(
  dbStatus: RuntimeSnapshot["infra"]["dbStatus"],
  domainScope: RuntimeSnapshot["state"]["domainScope"],
  containerId: RuntimeSnapshot["state"]["containerId"],
  documentQueries: ContainerDocumentQueries,
) {
  const tearleads = useTearleads();
  const [documentSummaries, setDocumentSummaries] = useState<
    ReadonlyArray<DocumentSummary>
  >([]);
  const [documentListRevision, setDocumentListRevision] = useState(0);
  const domainScopeRef = useRef(domainScope);

  useEffect(() => {
    if (dbStatus !== "ready") {
      setDocumentSummaries([]);
      setDocumentListRevision((revision) => revision + 1);
    }
  }, [dbStatus]);

  useEffect(() => {
    if (domainScopeRef.current === domainScope) {
      return;
    }

    domainScopeRef.current = domainScope;
    setDocumentSummaries([]);
    setDocumentListRevision((revision) => revision + 1);
  }, [domainScope]);

  // Force the container item listing to re-query SQLite without changing the
  // in-memory summaries (e.g. after a document was deleted out from under the
  // current view). The detail pane keys its reload on documentListRevision.
  const bumpDocumentListRevision = useCallback(() => {
    setDocumentListRevision((revision) => revision + 1);
  }, []);

  const mergeDocumentSummary = useCallback((nextDocument: DocumentSummary) => {
    setDocumentListRevision((revision) => revision + 1);
    setDocumentSummaries((currentDocumentSummaries) =>
      mergeSingleDocumentSummaryList(currentDocumentSummaries, nextDocument),
    );
  }, []);

  const mergeDocumentSummaries = useCallback(
    (nextDocuments: ReadonlyArray<DocumentSummary>) => {
      setDocumentListRevision((revision) => revision + 1);
      setDocumentSummaries((currentDocumentSummaries) =>
        mergeDocumentSummaryLists(
          currentDocumentSummaries,
          nextDocuments.filter((nextDocument) =>
            currentDocumentSummaries.some(
              (currentDocument) => currentDocument.id === nextDocument.id,
            ),
          ),
        ),
      );
    },
    [],
  );

  const mergeTrackedDocumentSummary = useCallback(
    (nextDocument: DocumentSummary) => {
      setDocumentListRevision((revision) => revision + 1);
      setDocumentSummaries((currentDocumentSummaries) => {
        if (
          !currentDocumentSummaries.some(
            (currentDocument) => currentDocument.id === nextDocument.id,
          )
        ) {
          return currentDocumentSummaries;
        }

        return mergeSingleDocumentSummaryList(
          currentDocumentSummaries,
          nextDocument,
        );
      });
    },
    [],
  );

  const loadDocumentSummary = useCallback(
    async (localId: string): Promise<DocumentSummary | null> => {
      if (dbStatus !== "ready") {
        return null;
      }

      const documentSummary =
        await documentQueries.loadDocumentSummary(localId);
      if (documentSummary) {
        mergeDocumentSummary(documentSummary);
      }

      return documentSummary;
    },
    [dbStatus, documentQueries, mergeDocumentSummary],
  );

  useEffect(() => {
    return tearleads.documents.subscribe(mergeTrackedDocumentSummary, {
      containerId,
    });
  }, [containerId, domainScope, mergeTrackedDocumentSummary, tearleads]);

  return {
    bumpDocumentListRevision,
    documentListRevision,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
  };
}
