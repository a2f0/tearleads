import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  initialDocumentSummaryLoad,
  transitionDocumentSummaryLoad,
} from "../../../../stores/explorer/documentSummaryLoadMachine";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

/**
 * The summary of a document a route names by local id: the caller's fallback
 * when it already holds that document, otherwise loaded. `retry` asks the
 * loader again, for a document that may have hydrated since it answered with
 * none.
 */
export function useExplorerDocumentSummary(params: {
  fallbackDocumentSummary: DocumentSummary | null;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  localId: string;
}) {
  const { fallbackDocumentSummary, loadDocumentSummary, localId } = params;
  const known =
    fallbackDocumentSummary?.id === localId ? fallbackDocumentSummary : null;
  const [state, send] = useReducer(
    transitionDocumentSummaryLoad,
    known,
    initialDocumentSummaryLoad,
  );
  const latestRequest = useRef(0);

  const load = useCallback(() => {
    if (known !== null) {
      send({ documentSummary: known, type: "known" });
      return;
    }
    latestRequest.current += 1;
    const request = latestRequest.current;
    send({ request, type: "load-started" });
    loadDocumentSummary(localId).then(
      (documentSummary) =>
        send({ documentSummary, request, type: "load-finished" }),
      (error: unknown) =>
        send({
          message: unknownErrorMessage(error),
          request,
          type: "load-failed",
        }),
    );
  }, [known, loadDocumentSummary, localId]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    // Effects run after the render that changes `localId`: never hand that
    // render the previous document's summary.
    documentSummary:
      state.status === "loaded" && state.documentSummary.id === localId
        ? state.documentSummary
        : null,
    documentSummaryError: state.status === "failed" ? state.message : null,
    isLoadingDocumentSummary: state.status === "loading",
    retry: load,
  };
}
