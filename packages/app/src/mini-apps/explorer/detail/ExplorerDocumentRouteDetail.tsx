import type { DocumentSummary } from "@tearleads/client-sdk";
import type { ComponentProps } from "react";
import type { ExplorerRoute } from "../routes";
import { ExplorerDocumentInfoPanel } from "./document/ExplorerDocumentInfoPanel";
import { getDocumentInfoRouteFallbackSummary } from "./documentInfoRouteSummary";
import { ExplorerDocumentHistoryPanel } from "./history/ExplorerDocumentHistoryPanel";

/** A route that names one document by local id and shows a view of it. */
type ExplorerDocumentViewRoute = Extract<
  ExplorerRoute,
  { view: "document-history" | "document-info" }
>;

export function isExplorerDocumentViewRoute(
  route: ExplorerRoute,
): route is ExplorerDocumentViewRoute {
  return route.view === "document-info" || route.view === "document-history";
}

type DocumentInfoPanelProps = ComponentProps<typeof ExplorerDocumentInfoPanel>;

/**
 * The views of one document that a route names by local id: its info and its
 * history.
 */
export function ExplorerDocumentRouteDetail(
  params: Omit<
    DocumentInfoPanelProps,
    "containerId" | "documentTitle" | "fallbackDocumentSummary" | "localId"
  > & {
    documentSummaries: ReadonlyArray<DocumentSummary>;
    /** The route's container is read-only, such as the Trash. */
    readOnly: boolean;
    route: ExplorerDocumentViewRoute;
    selectedDocument: DocumentSummary | undefined;
  },
) {
  const { documentSummaries, readOnly, route, selectedDocument, ...infoProps } =
    params;
  const fallbackDocumentSummary = getDocumentInfoRouteFallbackSummary({
    documentSummaries,
    localId: route.localId,
    selectedDocument,
  });

  if (route.view === "document-history") {
    return (
      <ExplorerDocumentHistoryPanel
        fallbackDocumentSummary={fallbackDocumentSummary}
        loadDocumentSummary={params.loadDocumentSummary}
        localId={route.localId}
        readOnly={readOnly}
      />
    );
  }

  return (
    <ExplorerDocumentInfoPanel
      {...infoProps}
      containerId={route.containerId}
      documentTitle={fallbackDocumentSummary?.title}
      fallbackDocumentSummary={fallbackDocumentSummary}
      localId={route.localId}
    />
  );
}
