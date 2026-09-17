import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { primeDocumentSummaries } from "../documents/primeDocumentSummaries";
import { useExplorerDocumentLinks } from "./documentRuntime";

export function usePrimeDiscoveredDocuments() {
  const documentLinks = useExplorerDocumentLinks();

  const primeDiscoveredDocuments = useCallback(
    (discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>) => {
      primeDocumentSummaries({
        summaries: discoveredDocumentSummaries,
        documentLinks,
      });
    },
    [documentLinks],
  );

  return { primeDiscoveredDocuments };
}
