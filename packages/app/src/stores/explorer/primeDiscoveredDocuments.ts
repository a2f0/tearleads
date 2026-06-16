import type {
  ContainerDocumentLinks,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  type ExplorerDocumentLinksRuntimeInput,
  useExplorerDocumentLinks,
} from "./documentRuntime";

/**
 * Open document stores for a set of discovered/reconciled summaries so their
 * content is ready when the user opens them. Priming never forces a sync; the
 * background reconciler owns remote work.
 */
export function primeDiscoveredDocumentStores(input: {
  discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>;
  documentLinks: Pick<ContainerDocumentLinks, "openDocument">;
}) {
  for (const documentSummary of input.discoveredDocumentSummaries) {
    if (!documentSummary.containerId || !documentSummary.documentId) {
      continue;
    }

    input.documentLinks.openDocument({
      containerId: documentSummary.containerId,
      documentId: documentSummary.documentId,
      localId: documentSummary.id,
    });
  }
}

export function usePrimeDiscoveredDocuments(params: {
  appData: ExplorerDocumentLinksRuntimeInput;
}) {
  const documentLinks = useExplorerDocumentLinks(params.appData);

  const primeDiscoveredDocuments = useCallback(
    (discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>) => {
      primeDiscoveredDocumentStores({
        discoveredDocumentSummaries,
        documentLinks,
      });
    },
    [documentLinks],
  );

  return { primeDiscoveredDocuments };
}
