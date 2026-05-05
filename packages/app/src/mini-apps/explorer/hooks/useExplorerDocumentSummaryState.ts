import { useCallback, useEffect, useState } from "react";
import type { DocumentSummary } from "../../../data/persistence/documents/documentsPersistence";
import type { useAppData } from "../../../providers/data/AppDataProvider";
import { subscribeToPersistedDocuments } from "../../../stores/documents/DocumentsProvider";
import { listVisibleExplorerDocumentSummaries } from "../../../stores/explorer/documentReadModel";
import {
  mergeDocumentSummaryLists,
  mergeSingleDocumentSummaryList,
} from "../documentSummaryUtils";
import type { ContainerNode } from "../types";

export function useExplorerDocumentSummaryState(
  dbStatus: ReturnType<typeof useAppData>["dbStatus"],
  domainScope: ReturnType<typeof useAppData>["domainScope"],
  execSql: ReturnType<typeof useAppData>["execSql"],
  nodes: ReadonlyArray<ContainerNode>,
) {
  const [documentSummaries, setDocumentSummaries] = useState<
    ReadonlyArray<DocumentSummary>
  >([]);

  useEffect(() => {
    if (dbStatus !== "ready") {
      setDocumentSummaries([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      const visibleDocuments = await listVisibleExplorerDocumentSummaries(
        execSql,
        nodes,
      );
      const validContainerIds = new Set(nodes.map((node) => node.id));

      if (!cancelled) {
        setDocumentSummaries((currentDocumentSummaries) => {
          const visibleDocumentsById = new Map(
            visibleDocuments.map((documentSummary) => [
              documentSummary.id,
              documentSummary,
            ]),
          );
          const pendingVisibleDocuments = currentDocumentSummaries.filter(
            (documentSummary) =>
              documentSummary.containerId &&
              validContainerIds.has(documentSummary.containerId) &&
              !visibleDocumentsById.has(documentSummary.id),
          );

          return [...visibleDocuments, ...pendingVisibleDocuments];
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dbStatus, domainScope, execSql, nodes]);

  const mergeDocumentSummary = useCallback((nextDocument: DocumentSummary) => {
    setDocumentSummaries((currentDocumentSummaries) =>
      mergeSingleDocumentSummaryList(currentDocumentSummaries, nextDocument),
    );
  }, []);

  const mergeDocumentSummaries = useCallback(
    (nextDocuments: ReadonlyArray<DocumentSummary>) => {
      setDocumentSummaries((currentDocumentSummaries) =>
        mergeDocumentSummaryLists(currentDocumentSummaries, nextDocuments),
      );
    },
    [],
  );

  useEffect(() => {
    return subscribeToPersistedDocuments(domainScope, mergeDocumentSummary);
  }, [domainScope, mergeDocumentSummary]);

  return { mergeDocumentSummaries, mergeDocumentSummary, documentSummaries };
}
