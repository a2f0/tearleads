import type {
  ContainerDocumentLinks,
  DocumentSummary,
} from "@symcrypt/client-sdk";
import { useCallback } from "react";
import { useExplorerDocumentLinks } from "./documentRuntime";

/**
 * Open document stores for a set of discovered/reconciled summaries so their
 * content is ready when the user opens them. Priming never forces a sync; the
 * background reconciler owns remote work.
 */
function primeDiscoveredDocumentStores(input: {
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

export function usePrimeDiscoveredDocuments() {
  const documentLinks = useExplorerDocumentLinks();

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
