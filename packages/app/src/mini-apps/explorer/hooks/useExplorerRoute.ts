import type { ContainerNode } from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMiniAppRouteSegments } from "../../../navigation/AppNavigationProvider";
import type { MiniAppId } from "../../types";
import {
  DEFAULT_EXPLORER_ROUTE,
  type ExplorerRoute,
  type ExplorerRouteSnapshot,
  formatExplorerRouteSegments,
  isExplorerRouteAvailable,
  parseExplorerRouteSegments,
} from "../routes";

export interface ExplorerRouteState {
  route: ExplorerRoute;
  navigateBackFromBlobBrowser: () => void;
  openBlobBrowserRoute: (input?: {
    blobId?: string | null | undefined;
    storageKey?: string | null | undefined;
  }) => void;
  openContainerInfoRoute: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openNewStructuredDocumentRoute: (containerId: string) => void;
  openSyncLaneDetailRoute: (laneKey: string) => void;
  openSyncLanesRoute: () => void;
  openUploadsRoute: () => void;
  openWriteQueueRoute: () => void;
  selectExplorerDocument: (localId: string, containerId: string) => void;
  selectExplorerItem: (id: string | null) => void;
  showSelectionRoute: () => void;
}

type ExplorerRouteSetter = (
  nextRoute: ExplorerRoute,
  selectedId?: string | null | undefined,
  options?: { replace?: boolean | undefined },
) => void;

function useExplorerRouteBinding() {
  const appRoute = useMiniAppRouteSegments("explorer" satisfies MiniAppId);
  const { isRouted, pathSegments, setPathSegments } = appRoute;
  const [localRoute, setLocalRoute] = useState<ExplorerRoute>(
    DEFAULT_EXPLORER_ROUTE,
  );
  const parsedAppRoute = useMemo(
    () => (isRouted ? parseExplorerRouteSegments(pathSegments) : null),
    [isRouted, pathSegments],
  );
  const route = parsedAppRoute?.route ?? localRoute;
  const routeSnapshot = useMemo<ExplorerRouteSnapshot>(
    () => parsedAppRoute ?? { route },
    [parsedAppRoute, route],
  );
  const setRoute = useCallback<ExplorerRouteSetter>(
    (nextRoute, selectedId, options = {}) => {
      if (isRouted) {
        setPathSegments(
          formatExplorerRouteSegments(nextRoute, selectedId),
          options,
        );
        return;
      }

      setLocalRoute(nextRoute);
    },
    [isRouted, setPathSegments],
  );

  return { appRoute, parsedAppRoute, route, routeSnapshot, setRoute };
}

function useExplorerRouteSelectionEffect(params: {
  appRouteIsRouted: boolean;
  loadDocumentSummary: (localId: string) => Promise<unknown>;
  parsedAppRoute: ExplorerRouteSnapshot | null;
  selectDocument: (id: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    appRouteIsRouted,
    loadDocumentSummary,
    parsedAppRoute,
    selectDocument,
    setSelectedId,
  } = params;
  const route = parsedAppRoute?.route;
  const documentSelectionContainerId =
    route?.view === "document-selection" ? route.containerId : null;
  const documentSelectionLocalId =
    route?.view === "document-selection" ? route.localId : null;
  const selectedId = parsedAppRoute?.selectedId;
  useEffect(() => {
    if (!appRouteIsRouted) {
      return;
    }

    if (documentSelectionContainerId && documentSelectionLocalId) {
      selectDocument(documentSelectionLocalId, documentSelectionContainerId);
      // selectDocument only marks the document selected (pending). When the
      // route is restored into a freshly mounted Explorer — e.g. crossing the
      // windowed/routed breakpoint or a workspace round trip remounts the
      // pane — the new view starts with no loaded summaries, so load the
      // document too. Otherwise the pending selection never resolves and the
      // detail pane is stranded on "Select a container." loadDocumentSummary
      // no-ops until the database is ready and merges on success.
      void loadDocumentSummary(documentSelectionLocalId);
      return;
    }

    if (selectedId === undefined) {
      return;
    }

    setSelectedId(selectedId);
  }, [
    appRouteIsRouted,
    documentSelectionContainerId,
    documentSelectionLocalId,
    loadDocumentSummary,
    selectDocument,
    selectedId,
    setSelectedId,
  ]);
}

function useAvailableExplorerRoute(params: {
  nodes: ReadonlyArray<ContainerNode>;
  route: ExplorerRoute;
  setRoute: ExplorerRouteSetter;
}) {
  const { nodes, route, setRoute } = params;
  useEffect(() => {
    if (!isExplorerRouteAvailable(route, nodes)) {
      setRoute(DEFAULT_EXPLORER_ROUTE, null, { replace: true });
    }
  }, [nodes, route, setRoute]);
}

function useExplorerBlobBrowserRouteActions(params: {
  routeSnapshot: ExplorerRouteSnapshot;
  setRoute: ExplorerRouteSetter;
}) {
  const { routeSnapshot, setRoute } = params;
  const routeSnapshotRef = useRef(routeSnapshot);
  const blobBrowserOriginRef = useRef<ExplorerRouteSnapshot | null>(null);

  useEffect(() => {
    routeSnapshotRef.current = routeSnapshot;
    // Leaving through the sidebar, a document reference, or an externally
    // supplied window route abandons the current blob visit. Do not let its
    // remembered origin leak into a later direct blob deep link.
    if (routeSnapshot.route.view !== "blob-browser") {
      blobBrowserOriginRef.current = null;
    }
  }, [routeSnapshot]);

  const openBlobBrowserRoute = useCallback(
    (
      input: {
        blobId?: string | null | undefined;
        storageKey?: string | null | undefined;
      } = {},
    ) => {
      const currentRouteSnapshot = routeSnapshotRef.current;
      if (currentRouteSnapshot.route.view !== "blob-browser") {
        blobBrowserOriginRef.current = currentRouteSnapshot;
      }

      setRoute(
        {
          blobId: input.blobId ?? null,
          storageKey: input.storageKey ?? null,
          view: "blob-browser",
        },
        undefined,
      );
    },
    [setRoute],
  );

  const navigateBackFromBlobBrowser = useCallback(() => {
    const origin = blobBrowserOriginRef.current;
    blobBrowserOriginRef.current = null;
    if (origin) {
      setRoute(origin.route, origin.selectedId);
      return;
    }

    const currentRoute = routeSnapshotRef.current.route;
    if (
      currentRoute.view === "blob-browser" &&
      (currentRoute.blobId !== null || currentRoute.storageKey !== null)
    ) {
      setRoute(
        { blobId: null, storageKey: null, view: "blob-browser" },
        undefined,
        { replace: true },
      );
      return;
    }

    setRoute(DEFAULT_EXPLORER_ROUTE, null, { replace: true });
  }, [setRoute]);

  return { navigateBackFromBlobBrowser, openBlobBrowserRoute };
}

function useExplorerRouteActions(params: {
  routeSnapshot: ExplorerRouteSnapshot;
  route: ExplorerRoute;
  selectDocument: (id: string, containerId: string) => void;
  setRoute: ExplorerRouteSetter;
  setSelectedId: (id: string | null) => void;
}) {
  const { route, routeSnapshot, selectDocument, setRoute, setSelectedId } =
    params;
  const blobBrowserActions = useExplorerBlobBrowserRouteActions({
    routeSnapshot,
    setRoute,
  });

  const showSelectionRoute = useCallback(() => {
    setRoute(DEFAULT_EXPLORER_ROUTE);
  }, [setRoute]);

  const selectExplorerItem = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setRoute(DEFAULT_EXPLORER_ROUTE, id);
    },
    [setRoute, setSelectedId],
  );

  const selectExplorerDocument = useCallback(
    (localId: string, containerId: string) => {
      selectDocument(localId, containerId);
      setRoute(
        {
          containerId,
          localId,
          view: "document-selection",
        },
        localId,
      );
    },
    [selectDocument, setRoute],
  );

  const openSyncLanesRoute = useCallback(() => {
    setRoute({ view: "sync-lanes" }, undefined);
  }, [setRoute]);

  const openSyncLaneDetailRoute = useCallback(
    (laneKey: string) => {
      setRoute({ laneKey, view: "sync-lane-detail" }, undefined);
    },
    [setRoute],
  );

  const openWriteQueueRoute = useCallback(() => {
    setRoute({ view: "write-queue" }, undefined);
  }, [setRoute]);

  const openUploadsRoute = useCallback(() => {
    setRoute({ view: "uploads" }, undefined);
  }, [setRoute]);

  const openContainerInfoRoute = useCallback(
    (containerId: string) => {
      setSelectedId(containerId);
      setRoute({ view: "container-info", containerId }, containerId);
    },
    [setRoute, setSelectedId],
  );

  const openDocumentInfoRoute = useCallback(
    (localId: string, containerId: string) => {
      setRoute({ view: "document-info", containerId, localId });
    },
    [setRoute],
  );

  const openNewStructuredDocumentRoute = useCallback(
    (containerId: string) => {
      setSelectedId(containerId);
      setRoute({ view: "new-structured-document", containerId }, containerId);
    },
    [setRoute, setSelectedId],
  );

  return {
    ...blobBrowserActions,
    openContainerInfoRoute,
    openDocumentInfoRoute,
    openNewStructuredDocumentRoute,
    openSyncLaneDetailRoute,
    openSyncLanesRoute,
    openUploadsRoute,
    openWriteQueueRoute,
    route,
    selectExplorerDocument,
    selectExplorerItem,
    showSelectionRoute,
  };
}

export function useExplorerRoute(params: {
  loadDocumentSummary: (localId: string) => Promise<unknown>;
  nodes: ReadonlyArray<ContainerNode>;
  selectDocument: (id: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
}): ExplorerRouteState {
  const { loadDocumentSummary, nodes, selectDocument, setSelectedId } = params;
  const { appRoute, parsedAppRoute, route, routeSnapshot, setRoute } =
    useExplorerRouteBinding();
  useExplorerRouteSelectionEffect({
    appRouteIsRouted: appRoute.isRouted,
    loadDocumentSummary,
    parsedAppRoute,
    selectDocument,
    setSelectedId,
  });
  useAvailableExplorerRoute({ nodes, route, setRoute });
  const actions = useExplorerRouteActions({
    route,
    routeSnapshot,
    selectDocument,
    setRoute,
    setSelectedId,
  });

  return {
    ...actions,
    route,
  };
}
