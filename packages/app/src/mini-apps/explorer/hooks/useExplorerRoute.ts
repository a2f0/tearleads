import type { ContainerNode } from "@symcrypt/client-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMiniAppRouteSegments } from "../../../navigation/AppNavigationProvider";
import { isIgnorableDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import { isExplorerOrphanedDocumentsId } from "../../../stores/explorer/orphanedDocuments";
import type { ExplorerRouteDocumentSummaryResult } from "../../../stores/explorer/useExplorerDocumentSummaryState";
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
  openSyncLanesRoute: (options?: ExplorerRouteNavigationOptions) => void;
  openUploadsRoute: () => void;
  openWriteQueueRoute: (options?: ExplorerRouteNavigationOptions) => void;
  openWriteQueueEntryRoute: (entryKey: string) => void;
  selectCreatedExplorerItem: (id: string) => void;
  selectExplorerDocument: (
    localId: string,
    containerId: string,
    options?: ExplorerRouteNavigationOptions,
  ) => void;
  selectExplorerItem: (
    id: string | null,
    options?: ExplorerRouteNavigationOptions,
  ) => void;
  showSelectionRoute: (options?: ExplorerRouteNavigationOptions) => void;
}

/**
 * Navigation options for the route actions a detail "Back" fallback uses. That
 * fallback only exists where the host has NO history entry to pop, so it must
 * replace the dead-end entry rather than push its parent on top: pushing would
 * create the single history entry that makes Back alternate between the two
 * routes forever (see chromeOwnsRouteBackedDetailBack).
 */
export interface ExplorerRouteNavigationOptions {
  replace?: boolean | undefined;
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
  loadDocumentSummary: (
    localId: string,
    routeContainerId: string,
  ) => Promise<ExplorerRouteDocumentSummaryResult>;
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
      return undefined;
    }

    if (documentSelectionContainerId && documentSelectionLocalId) {
      let active = true;
      void loadDocumentSummary(
        documentSelectionLocalId,
        documentSelectionContainerId,
      )
        .then((result) => {
          if (!active || result.status === "deferred") {
            return;
          }
          if (result.status === "pending") {
            selectDocument(
              documentSelectionLocalId,
              documentSelectionContainerId,
            );
            return;
          }
          // A null-container document is valid only through the organization-
          // scoped recovery collection. A crafted ordinary-container deep link
          // must not select a cached orphan and expose its Move action.
          if (
            result.status === "loaded" &&
            (isExplorerOrphanedDocumentsId(documentSelectionContainerId) ||
              result.documentSummary.containerId !== null)
          ) {
            selectDocument(
              documentSelectionLocalId,
              documentSelectionContainerId,
            );
          } else {
            setSelectedId(null);
          }
        })
        .catch((error: unknown) => {
          if (!active || isIgnorableDatabaseWorkerError(error)) {
            return;
          }
          console.error("Explorer: failed to restore document route:", error);
          setSelectedId(null);
        });
      return () => {
        active = false;
      };
    }

    if (selectedId === undefined) {
      return undefined;
    }

    setSelectedId(selectedId);
    return undefined;
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

  // Only ever reached as a detail "Back" fallback (no history to pop), so every
  // exit replaces rather than pushes — see ExplorerRouteNavigationOptions.
  const navigateBackFromBlobBrowser = useCallback(() => {
    const origin = blobBrowserOriginRef.current;
    blobBrowserOriginRef.current = null;
    if (origin) {
      setRoute(origin.route, origin.selectedId, { replace: true });
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

// The full-screen diagnostics hub's route openers (sync lanes, blob/upload
// queues, durable writes). Grouped into their own hook so the main actions hook
// stays small.
function useExplorerSectionRouteActions(setRoute: ExplorerRouteSetter) {
  const openSyncLanesRoute = useCallback(
    (options: ExplorerRouteNavigationOptions = {}) => {
      setRoute({ view: "sync-lanes" }, undefined, options);
    },
    [setRoute],
  );

  const openSyncLaneDetailRoute = useCallback(
    (laneKey: string) => {
      setRoute({ laneKey, view: "sync-lane-detail" }, undefined);
    },
    [setRoute],
  );

  const openWriteQueueRoute = useCallback(
    (options: ExplorerRouteNavigationOptions = {}) => {
      setRoute({ view: "write-queue" }, undefined, options);
    },
    [setRoute],
  );

  const openWriteQueueEntryRoute = useCallback(
    (entryKey: string) => {
      setRoute({ entryKey, view: "write-queue-entry" }, undefined);
    },
    [setRoute],
  );

  const openUploadsRoute = useCallback(() => {
    setRoute({ view: "uploads" }, undefined);
  }, [setRoute]);

  return {
    openSyncLaneDetailRoute,
    openSyncLanesRoute,
    openUploadsRoute,
    openWriteQueueEntryRoute,
    openWriteQueueRoute,
  };
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
  const sectionActions = useExplorerSectionRouteActions(setRoute);

  const showSelectionRoute = useCallback(
    (options: ExplorerRouteNavigationOptions = {}) => {
      setRoute(DEFAULT_EXPLORER_ROUTE, undefined, options);
    },
    [setRoute],
  );

  const selectExplorerItem = useCallback(
    (id: string | null, options: ExplorerRouteNavigationOptions = {}) => {
      setSelectedId(id);
      setRoute(DEFAULT_EXPLORER_ROUTE, id, options);
    },
    [setRoute, setSelectedId],
  );

  // Lands on a document that was just created. The "New Document" type picker is
  // a transient step on the way there, so replace it instead of pushing the new
  // document on top of it: navigating back should return to wherever the user
  // opened the picker from, not re-open the blank picker. Creating from anywhere
  // else (the Explorer's "New Contact" shortcut) has nothing to prune and pushes.
  const selectCreatedExplorerItem = useCallback(
    (id: string) => {
      setSelectedId(id);
      setRoute(DEFAULT_EXPLORER_ROUTE, id, {
        replace: route.view === "new-structured-document",
      });
    },
    [route.view, setRoute, setSelectedId],
  );

  const selectExplorerDocument = useCallback(
    (
      localId: string,
      containerId: string,
      options: ExplorerRouteNavigationOptions = {},
    ) => {
      selectDocument(localId, containerId);
      setRoute(
        {
          containerId,
          localId,
          view: "document-selection",
        },
        localId,
        options,
      );
    },
    [selectDocument, setRoute],
  );

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
    ...sectionActions,
    openContainerInfoRoute,
    openDocumentInfoRoute,
    openNewStructuredDocumentRoute,
    route,
    selectCreatedExplorerItem,
    selectExplorerDocument,
    selectExplorerItem,
    showSelectionRoute,
  };
}

export function useExplorerRoute(params: {
  loadDocumentSummary: (
    localId: string,
    routeContainerId: string,
  ) => Promise<ExplorerRouteDocumentSummaryResult>;
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
