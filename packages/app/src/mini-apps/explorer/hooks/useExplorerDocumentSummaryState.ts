import { useCallback, useEffect, useState } from "react";
import { subscribeToPersistedDocuments } from "../../../data/documents/DocumentsProvider";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  type DocumentSummary,
  sqlDocumentsPersistence,
} from "../../../data/persistence/documents/documentsPersistence";
import type { useAppData } from "../../../providers/data/AppDataProvider";
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
      await sqlDocumentContainerProjectionPersistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const storedDocuments =
        await sqlDocumentsPersistence.listDocuments(execSql);
      const validContainerIds = new Set(nodes.map((node) => node.id));
      const visibleDocuments = storedDocuments.filter(
        (documentSummary) =>
          documentSummary.containerId &&
          validContainerIds.has(documentSummary.containerId),
      );

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
