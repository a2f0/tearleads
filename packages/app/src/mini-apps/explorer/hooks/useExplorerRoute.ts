import type { ContainerNode } from "@tearleads/client-sdk";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_EXPLORER_ROUTE,
  type ExplorerRoute,
  isExplorerRouteAvailable,
} from "../routes";

export interface ExplorerRouteState {
  route: ExplorerRoute;
  openBlobBrowserRoute: (input?: {
    blobId?: string | null | undefined;
    storageKey?: string | null | undefined;
  }) => void;
  openContainerInfoRoute: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openNewStructuredDocumentRoute: (containerId: string) => void;
  selectExplorerItem: (id: string | null) => void;
  showSelectionRoute: () => void;
}

export function useExplorerRoute(params: {
  nodes: ReadonlyArray<ContainerNode>;
  setSelectedId: (id: string | null) => void;
}): ExplorerRouteState {
  const { nodes, setSelectedId } = params;
  const [route, setRoute] = useState<ExplorerRoute>(DEFAULT_EXPLORER_ROUTE);

  useEffect(() => {
    if (!isExplorerRouteAvailable(route, nodes)) {
      setRoute(DEFAULT_EXPLORER_ROUTE);
    }
  }, [nodes, route]);

  const showSelectionRoute = useCallback(() => {
    setRoute(DEFAULT_EXPLORER_ROUTE);
  }, []);

  const selectExplorerItem = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setRoute(DEFAULT_EXPLORER_ROUTE);
    },
    [setSelectedId],
  );

  const openBlobBrowserRoute = useCallback(
    (
      input: {
        blobId?: string | null | undefined;
        storageKey?: string | null | undefined;
      } = {},
    ) => {
      setRoute({
        blobId: input.blobId ?? null,
        storageKey: input.storageKey ?? null,
        view: "blob-browser",
      });
    },
    [],
  );

  const openContainerInfoRoute = useCallback(
    (containerId: string) => {
      setSelectedId(containerId);
      setRoute({ view: "container-info", containerId });
    },
    [setSelectedId],
  );

  const openDocumentInfoRoute = useCallback(
    (localId: string, containerId: string) => {
      setRoute({ view: "document-info", containerId, localId });
    },
    [],
  );

  const openNewStructuredDocumentRoute = useCallback(
    (containerId: string) => {
      setSelectedId(containerId);
      setRoute({ view: "new-structured-document", containerId });
    },
    [setSelectedId],
  );

  return {
    openBlobBrowserRoute,
    openContainerInfoRoute,
    openDocumentInfoRoute,
    openNewStructuredDocumentRoute,
    route,
    selectExplorerItem,
    showSelectionRoute,
  };
}
