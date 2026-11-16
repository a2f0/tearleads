import type { DocumentSummary } from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

/**
 * The summary of a document a route names by local id: the caller's fallback
 * when it already holds that document, otherwise loaded.
 */
export function useExplorerDocumentSummary(params: {
  fallbackDocumentSummary: DocumentSummary | null;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  localId: string;
}) {
  const { fallbackDocumentSummary, loadDocumentSummary, localId } = params;
  const requestIdRef = useRef(0);
  const [documentSummary, setDocumentSummary] =
    useState<DocumentSummary | null>(
      fallbackDocumentSummary?.id === localId ? fallbackDocumentSummary : null,
    );
  const [documentSummaryError, setDocumentSummaryError] = useState<
    string | null
  >(null);
  const [isLoadingDocumentSummary, setIsLoadingDocumentSummary] =
    useState(false);

  useEffect(() => {
    const fallback =
      fallbackDocumentSummary?.id === localId ? fallbackDocumentSummary : null;
    setDocumentSummary(fallback);
    setDocumentSummaryError(null);
    if (fallback) {
      setIsLoadingDocumentSummary(false);
      return;
    }

    let cancelled = false;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoadingDocumentSummary(true);

    void loadDocumentSummary(localId)
      .then((summary) => {
        if (!cancelled && requestIdRef.current === requestId) {
          setDocumentSummary(summary);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && requestIdRef.current === requestId) {
          setDocumentSummaryError(unknownErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled && requestIdRef.current === requestId) {
          setIsLoadingDocumentSummary(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackDocumentSummary, loadDocumentSummary, localId]);

  return { documentSummary, documentSummaryError, isLoadingDocumentSummary };
}
