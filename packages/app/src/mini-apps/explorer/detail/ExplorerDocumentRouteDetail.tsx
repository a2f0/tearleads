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
    /** Whether documents in a container are read-only, as in the Trash. */
    isContainerReadOnly: (containerId: string | null) => boolean;
    route: ExplorerDocumentViewRoute;
    selectedDocument: DocumentSummary | undefined;
  },
) {
  const {
    documentSummaries,
    isContainerReadOnly,
    route,
    selectedDocument,
    ...infoProps
  } = params;
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
        isContainerReadOnly={isContainerReadOnly}
        localId={route.localId}
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
