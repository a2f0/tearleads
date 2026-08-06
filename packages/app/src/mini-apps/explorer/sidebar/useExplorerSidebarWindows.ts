import type {
  ContainerDocumentQueries,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMiniAppVirtualWindow } from "../../../components/mini-app/virtual/MiniAppVirtual";
import { explorerDocumentQueryContainerId } from "../../../stores/explorer/orphanedDocuments";
import {
  buildExplorerSidebarSections,
  countExplorerSidebarRows,
  EXPLORER_SIDEBAR_MIN_WINDOW_ROWS,
  type ExplorerSidebarDocumentWindowState,
  type ExplorerSidebarVirtualRow,
  getExplorerSidebarDocumentWindowRequests,
  getExplorerSidebarRowsInRange,
} from "./ExplorerSidebarRows";
import {
  EXPLORER_SIDEBAR_ROW_HEIGHT,
  type ExplorerTreeEntry,
  getExplorerTreeIdSetKey,
  listExpandedExplorerTreeContainerIds,
} from "./explorerTreeModel";

// Minimum spacing between link-refresh reload passes. During a bulk import the
// target container's link-projection version bumps once per imported batch;
// firing a reload pass per bump would stack window queries behind the import's
// writes on the shared SQLite worker. Trailing throttle: the first bump arms
// the timer, further bumps within the window are absorbed, and the pass that
// fires reads the latest state — so the final reload always observes the
// settled membership.
const EXPLORER_SIDEBAR_RELOAD_COALESCE_MS = 150;

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The sidebar window hook owns paging, reload, and pruning state for a single UI surface.
export function useExplorerSidebarDocumentWindows(params: {
  collapsedIds: ReadonlySet<string>;
  documentLinkProjectionVersionByContainerId: ReadonlyMap<string, number>;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  nodes: ReadonlyArray<ContainerNode>;
  currentOrganizationId: string | null;
  ready: boolean;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    collapsedIds,
    currentOrganizationId,
    documentLinkProjectionVersionByContainerId,
    documentListRevision,
    documentQueries,
    nodes,
    ready,
    treeEntries,
  } = params;
  const loadGenerationRef = useRef(0);
  const latestWindowLoadKeyByContainerIdRef = useRef(new Map<string, string>());
  const pendingWindowLoadKeysRef = useRef(new Set<string>());
  const [documentWindowsByContainerId, setDocumentWindowsByContainerId] =
    useState<ReadonlyMap<string, ExplorerSidebarDocumentWindowState>>(
      () => new Map(),
    );
  const documentWindowsByContainerIdRef = useRef(documentWindowsByContainerId);
  documentWindowsByContainerIdRef.current = documentWindowsByContainerId;
  const collapsedIdsKey = useMemo(
    () => getExplorerTreeIdSetKey(collapsedIds),
    [collapsedIds],
  );
  const expandedContainerIds = useMemo(
    () => listExpandedExplorerTreeContainerIds(treeEntries, collapsedIds),
    [collapsedIdsKey, treeEntries],
  );
  const expandedContainerIdsKey = expandedContainerIds.join("\u0000");
  const expandedContainerIdsRef = useRef(expandedContainerIds);
  expandedContainerIdsRef.current = expandedContainerIds;
  const validContainerIdsKey = useMemo(
    () => nodes.map((node) => node.id).join("\u0000"),
    [nodes],
  );

  const requestDocumentWindow = useCallback(
    (containerId: string, offset: number, limit: number) => {
      const generation = loadGenerationRef.current;
      const loadKey = `${generation}\u0000${containerId}\u0000${offset}\u0000${limit}`;
      if (pendingWindowLoadKeysRef.current.has(loadKey)) {
        return;
      }

      pendingWindowLoadKeysRef.current.add(loadKey);
      if (limit > 0) {
        latestWindowLoadKeyByContainerIdRef.current.set(containerId, loadKey);
      }
      // Reloads are never destructive: the stale rows stay rendered while the
      // replacement window loads and are swapped in place when it lands, so a
      // link refresh during a bulk import cannot flash a populated container
      // back to an empty/loading state. The cost is that a just-unlinked row
      // stays visible for the reload's flight time.
      setDocumentWindowsByContainerId((currentWindows) => {
        const currentWindow = currentWindows.get(containerId);
        const nextWindows = new Map(currentWindows);
        nextWindows.set(containerId, {
          error: null,
          isLoading: true,
          offset: currentWindow?.offset ?? offset,
          rows: currentWindow?.rows ?? [],
          totalCount: currentWindow?.totalCount ?? null,
        });
        return nextWindows;
      });

      void documentQueries
        .listContainerDocumentSidebarWindow({
          containerId: explorerDocumentQueryContainerId(containerId),
          currentOrganizationId,
          limit,
          offset,
        })
        .then((documentWindow) => {
          pendingWindowLoadKeysRef.current.delete(loadKey);
          if (loadGenerationRef.current !== generation) {
            return;
          }
          if (
            limit > 0 &&
            latestWindowLoadKeyByContainerIdRef.current.get(containerId) !==
              loadKey
          ) {
            return;
          }

          setDocumentWindowsByContainerId((currentWindows) => {
            const currentWindow = currentWindows.get(containerId);
            const nextWindows = new Map(currentWindows);
            nextWindows.set(containerId, {
              error: null,
              isLoading: false,
              offset: limit === 0 ? (currentWindow?.offset ?? 0) : offset,
              rows:
                limit === 0 ? (currentWindow?.rows ?? []) : documentWindow.rows,
              totalCount: documentWindow.totalCount,
            });
            return nextWindows;
          });
        })
        .catch((error: unknown) => {
          pendingWindowLoadKeysRef.current.delete(loadKey);
          if (loadGenerationRef.current !== generation) {
            return;
          }
          if (
            limit > 0 &&
            latestWindowLoadKeyByContainerIdRef.current.get(containerId) !==
              loadKey
          ) {
            return;
          }

          setDocumentWindowsByContainerId((currentWindows) => {
            const currentWindow = currentWindows.get(containerId);
            const message =
              error instanceof Error ? error.message : String(error);
            const nextWindows = new Map(currentWindows);
            nextWindows.set(containerId, {
              error:
                limit === 0 && currentWindow?.totalCount != null
                  ? (currentWindow?.error ?? null)
                  : message,
              isLoading: false,
              offset: currentWindow?.offset ?? offset,
              rows: currentWindow?.rows ?? [],
              totalCount: currentWindow?.totalCount ?? null,
            });
            return nextWindows;
          });
        });
    },
    [currentOrganizationId, documentQueries],
  );

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    loadGenerationRef.current += 1;
    latestWindowLoadKeyByContainerIdRef.current.clear();
    pendingWindowLoadKeysRef.current.clear();
    // A reload pass armed against the previous query or organization scope
    // must not fire into the freshly wiped scope; the next version bump
    // re-arms it against the new one.
    if (reloadTimerRef.current !== null) {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    setDocumentWindowsByContainerId((currentWindows) =>
      currentWindows.size === 0 ? currentWindows : new Map(),
    );
  }, [currentOrganizationId, documentQueries]);

  const readyRef = useRef(ready);
  readyRef.current = ready;
  const runReloadPass = useCallback(() => {
    if (!readyRef.current) {
      return;
    }
    loadGenerationRef.current += 1;
    latestWindowLoadKeyByContainerIdRef.current.clear();
    pendingWindowLoadKeysRef.current.clear();
    for (const containerId of expandedContainerIdsRef.current) {
      const currentWindow =
        documentWindowsByContainerIdRef.current.get(containerId);
      requestDocumentWindow(
        containerId,
        currentWindow?.offset ?? 0,
        currentWindow?.rows.length ?? 0,
      );
    }
  }, [requestDocumentWindow]);
  // The timer always invokes the LATEST pass closure: an armed timer can
  // outlive the render that armed it, and firing a stale closure would issue
  // loads against a superseded documentQueries object.
  const runReloadPassRef = useRef(runReloadPass);
  runReloadPassRef.current = runReloadPass;
  useEffect(() => {
    if (!ready) {
      return;
    }

    // Trailing throttle, not debounce: continuous bumps during a long import
    // must still refresh once per window rather than starving until the churn
    // stops. An armed timer absorbs further bumps; the pass reads the latest
    // expanded/window state from refs when it fires.
    if (reloadTimerRef.current !== null) {
      return;
    }
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      runReloadPassRef.current();
    }, EXPLORER_SIDEBAR_RELOAD_COALESCE_MS);
  }, [documentLinkProjectionVersionByContainerId, documentListRevision, ready]);
  useEffect(
    () => () => {
      if (reloadTimerRef.current !== null) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!ready) {
      loadGenerationRef.current += 1;
      latestWindowLoadKeyByContainerIdRef.current.clear();
      pendingWindowLoadKeysRef.current.clear();
      setDocumentWindowsByContainerId((currentWindows) =>
        currentWindows.size === 0 ? currentWindows : new Map(),
      );
      return;
    }

    const validContainerIds = new Set(
      validContainerIdsKey ? validContainerIdsKey.split("\u0000") : [],
    );
    setDocumentWindowsByContainerId((currentWindows) => {
      let changed = false;
      const nextWindows = new Map<string, ExplorerSidebarDocumentWindowState>();
      for (const [containerId, state] of currentWindows.entries()) {
        if (validContainerIds.has(containerId)) {
          nextWindows.set(containerId, state);
        } else {
          changed = true;
        }
      }

      return changed ? nextWindows : currentWindows;
    });
  }, [ready, validContainerIdsKey]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    for (const containerId of expandedContainerIds) {
      if (!documentWindowsByContainerId.has(containerId)) {
        requestDocumentWindow(containerId, 0, 0);
      }
    }
  }, [
    documentWindowsByContainerId,
    expandedContainerIds,
    expandedContainerIdsKey,
    requestDocumentWindow,
    ready,
  ]);

  return {
    documentWindowsByContainerId,
    requestDocumentWindow,
  };
}

export function useExplorerSidebarVisibleRows(params: {
  collapsedIds: ReadonlySet<string>;
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  organizationNamesById: ReadonlyMap<string, string>;
  primaryOrganizationId: string | null;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    collapsedIds,
    documentWindowsByContainerId,
    organizationNamesById,
    primaryOrganizationId,
    treeEntries,
  } = params;
  const collapsedIdsKey = useMemo(
    () => getExplorerTreeIdSetKey(collapsedIds),
    [collapsedIds],
  );
  const {
    frameRef,
    limit: sidebarLimit,
    offset: sidebarRangeOffset,
  } = useMiniAppVirtualWindow({
    rowHeight: EXPLORER_SIDEBAR_ROW_HEIGHT,
  });
  const sidebarSections = useMemo(
    () =>
      buildExplorerSidebarSections({
        collapsedIds,
        documentWindowsByContainerId,
        entries: treeEntries,
        organizationNamesById,
        primaryOrganizationId,
      }),
    [
      collapsedIdsKey,
      documentWindowsByContainerId,
      organizationNamesById,
      primaryOrganizationId,
      treeEntries,
    ],
  );
  const totalRows = useMemo(
    () => countExplorerSidebarRows(sidebarSections),
    [sidebarSections],
  );
  const offset = Math.min(
    sidebarRangeOffset,
    Math.max(0, totalRows - sidebarLimit),
  );
  const rows = useMemo(
    () =>
      getExplorerSidebarRowsInRange({
        collapsedIds,
        limit: sidebarLimit,
        offset,
        sections: sidebarSections,
      }),
    [collapsedIdsKey, offset, sidebarLimit, sidebarSections],
  );

  return { frameRef, offset, rows, totalRows };
}

export function useExplorerSidebarDocumentWindowLoader(params: {
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  ready: boolean;
  requestDocumentWindow: (
    containerId: string,
    offset: number,
    limit: number,
  ) => void;
  rows: ReadonlyArray<ExplorerSidebarVirtualRow>;
}) {
  const { documentWindowsByContainerId, ready, requestDocumentWindow, rows } =
    params;
  const sidebarDocumentWindowRequests = useMemo(
    () =>
      getExplorerSidebarDocumentWindowRequests({
        documentWindowsByContainerId,
        rows,
      }),
    [documentWindowsByContainerId, rows],
  );
  const retryDocumentWindow = useCallback(
    (containerId: string, offset: number) => {
      requestDocumentWindow(
        containerId,
        offset,
        EXPLORER_SIDEBAR_MIN_WINDOW_ROWS,
      );
    },
    [requestDocumentWindow],
  );

  useEffect(() => {
    if (!ready) {
      return;
    }

    for (const request of sidebarDocumentWindowRequests) {
      if (request.limit > 0) {
        requestDocumentWindow(
          request.containerId,
          request.offset,
          request.limit,
        );
      }
    }
  }, [ready, requestDocumentWindow, sidebarDocumentWindowRequests]);

  return retryDocumentWindow;
}
