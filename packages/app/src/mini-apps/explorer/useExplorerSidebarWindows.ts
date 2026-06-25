import type {
  ContainerDocumentQueries,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMiniAppVirtualWindow } from "../../components/shared/MiniAppVirtual";
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The sidebar window hook owns paging, reload, and pruning state for a single UI surface.
export function useExplorerSidebarDocumentWindows(params: {
  collapsedIds: ReadonlySet<string>;
  documentLinkProjectionVersion: number;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    collapsedIds,
    documentLinkProjectionVersion,
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
    [collapsedIds, collapsedIdsKey, treeEntries],
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
          containerId,
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
    [documentQueries],
  );

  useEffect(() => {
    loadGenerationRef.current += 1;
    latestWindowLoadKeyByContainerIdRef.current.clear();
    pendingWindowLoadKeysRef.current.clear();
    setDocumentWindowsByContainerId((currentWindows) =>
      currentWindows.size === 0 ? currentWindows : new Map(),
    );
  }, [documentQueries]);

  useEffect(() => {
    if (!ready) {
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
  }, [
    documentLinkProjectionVersion,
    documentListRevision,
    requestDocumentWindow,
    ready,
  ]);

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

    const validContainerIds = new Set(nodes.map((node) => node.id));
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
  }, [nodes, ready, validContainerIdsKey]);

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
  currentOrganizationId: string | null;
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    collapsedIds,
    currentOrganizationId,
    documentWindowsByContainerId,
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
        currentOrganizationId,
        documentWindowsByContainerId,
        entries: treeEntries,
      }),
    [
      collapsedIdsKey,
      currentOrganizationId,
      documentWindowsByContainerId,
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
