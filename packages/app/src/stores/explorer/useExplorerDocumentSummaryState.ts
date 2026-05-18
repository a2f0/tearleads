import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentSummary } from "../../data/documentSummary";
import type { useAppData } from "../../providers/data/AppDataProvider";
import { subscribeToPersistedDocuments } from "../documents/DocumentsProvider";
import type { ExplorerDocumentReadModel } from "./documentReadModel";
import {
  mergeDocumentSummaryLists,
  mergeSingleDocumentSummaryList,
} from "./documentSummaryUtils";

export function useExplorerDocumentSummaryState(
  dbStatus: ReturnType<typeof useAppData>["dbStatus"],
  domainScope: ReturnType<typeof useAppData>["domainScope"],
  documentReadModel: ExplorerDocumentReadModel,
) {
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
        await documentReadModel.loadDocumentSummary(localId);
      if (documentSummary) {
        mergeDocumentSummary(documentSummary);
      }

      return documentSummary;
    },
    [dbStatus, documentReadModel, mergeDocumentSummary],
  );

  useEffect(() => {
    return subscribeToPersistedDocuments(
      domainScope,
      mergeTrackedDocumentSummary,
    );
  }, [domainScope, mergeTrackedDocumentSummary]);

  return {
    documentListRevision,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
  };
}
