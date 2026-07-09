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

interface RequestDocumentWindowOptions {
  preserveRows?: boolean | undefined;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The sidebar window hook owns paging, reload, and pruning state for a single UI surface.
export function useExplorerSidebarDocumentWindows(params: {
  collapsedIds: ReadonlySet<string>;
  documentLinkProjectionVersionByContainerId: ReadonlyMap<string, number>;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    collapsedIds,
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
    (
      containerId: string,
      offset: number,
      limit: number,
      options: RequestDocumentWindowOptions = {},
    ) => {
      const generation = loadGenerationRef.current;
      const loadKey = `${generation}\u0000${containerId}\u0000${offset}\u0000${limit}`;
      if (pendingWindowLoadKeysRef.current.has(loadKey)) {
        return;
      }
      const preserveRows = options.preserveRows ?? true;

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
          rows: preserveRows ? (currentWindow?.rows ?? []) : [],
          showLoadingStatus:
            preserveRows && currentWindow?.showLoadingStatus !== false,
          totalCount: preserveRows ? (currentWindow?.totalCount ?? null) : null,
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
              showLoadingStatus: true,
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
              showLoadingStatus: true,
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

  const lastVersionByContainerIdRef = useRef<ReadonlyMap<string, number>>(
    documentLinkProjectionVersionByContainerId,
  );
  useEffect(() => {
    if (!ready) {
      lastVersionByContainerIdRef.current =
        documentLinkProjectionVersionByContainerId;
      return;
    }

    const previousVersions = lastVersionByContainerIdRef.current;
    lastVersionByContainerIdRef.current =
      documentLinkProjectionVersionByContainerId;
    loadGenerationRef.current += 1;
    latestWindowLoadKeyByContainerIdRef.current.clear();
    pendingWindowLoadKeysRef.current.clear();
    for (const containerId of expandedContainerIdsRef.current) {
      const currentWindow =
        documentWindowsByContainerIdRef.current.get(containerId);
      // preserveRows:false is the DESTRUCTIVE reload (blanks rows to a loading
      // state). Fire it only for containers whose OWN membership version changed:
      // a bump for one org's container must not blank another org's expanded rows
      // (the cross-org flicker), and a content-only refresh (documentListRevision,
      // which leaves every version untouched) must not blank at all. The
      // sidebarReloadBudget canary bounds these destructive reloads.
      const containerMembershipChanged =
        (documentLinkProjectionVersionByContainerId.get(containerId) ?? 0) !==
        (previousVersions.get(containerId) ?? 0);
      requestDocumentWindow(
        containerId,
        currentWindow?.offset ?? 0,
        currentWindow?.rows.length ?? 0,
        { preserveRows: !containerMembershipChanged },
      );
    }
  }, [
    documentLinkProjectionVersionByContainerId,
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
