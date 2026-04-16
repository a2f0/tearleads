import type { ContainerDocumentSummary } from "@tearleads/validators/response";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePeerUserId } from "../../components/pane/DualPaneProvider";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useAppData } from "../../data/AppDataProvider";
import { sqlDocumentContainerProjectionPersistence } from "../../data/containers";
import {
  primeDocumentStore,
  subscribeToPersistedDocuments,
} from "../../data/documents/DocumentsProvider";
import {
  getUntitledDocumentTitle,
  type StoredDocumentKind,
} from "../../data/documents/documentKinds";
import {
  type DocumentSummary,
  sqlDocumentsPersistence,
  upsertDiscoveredDocuments,
} from "../../data/documents/documentsPersistence";
import {
  ExplorerContextMenuLayer,
  useExplorerContextMenu,
} from "./context-menu/ExplorerContextMenu";
import { ExplorerDetailPanel } from "./detail/ExplorerDetailPanel";
import { discoverAllContainerDocuments } from "./documentDiscovery";
import { useExplorer } from "./ExplorerProvider";
import {
  createExplorerDocumentsRuntime,
  isDestroyedDatabaseWorkerError,
} from "./explorerRuntime";
import { useDiscoveredDocumentsSync } from "./hooks/useDiscoveredDocumentsSync";
import {
  ExplorerModalLayer,
  useExplorerModalController,
} from "./modal/ExplorerModal";
import {
  createExplorerTargetLookups,
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
  type MoveTargetOption,
} from "./targetOptions";
import type { ContainerNode } from "./types";
import "./Explorer.css";

interface ExplorerTreeEntry {
  children: ExplorerTreeEntry[];
  node: ContainerNode;
}

interface DocumentContainerProjection {
  containerId: string;
  localId: string;
  title: string;
  updatedAt: string;
}

type OpenInlineDocument = (
  containerId: string,
  documentKind: StoredDocumentKind,
  localId?: string,
) => void;

function buildExplorerTree(
  nodes: ReadonlyArray<ContainerNode>,
): ExplorerTreeEntry[] {
  const entriesById = new Map<string, ExplorerTreeEntry>();
  for (const node of nodes) {
    entriesById.set(node.id, { children: [], node });
  }

  const roots: ExplorerTreeEntry[] = [];
  for (const entry of entriesById.values()) {
    if (entry.node.parentId && entriesById.has(entry.node.parentId)) {
      entriesById.get(entry.node.parentId)?.children.push(entry);
      continue;
    }

    roots.push(entry);
  }

  function sortEntries(entries: ExplorerTreeEntry[]) {
    entries.sort((left, right) =>
      left.node.name.localeCompare(right.node.name, undefined, {
        sensitivity: "base",
      }),
    );

    for (const entry of entries) {
      sortEntries(entry.children);
    }
  }

  sortEntries(roots);
  return roots;
}

function getMovedDocumentContainerId(
  document: ContainerDocumentSummary,
  preferredContainerId: string,
): string | null {
  if (document.linkedContainerIds.includes(preferredContainerId)) {
    return preferredContainerId;
  }

  return document.linkedContainerIds[0] ?? null;
}

async function moveExplorerDocument(params: {
  appData: ReturnType<typeof useAppData>;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, note, targetContainerId } = params;
  if (!note.documentId || !note.containerId) {
    return null;
  }

  const linkedDocument = await appData.apiClient.linkDocumentToContainer(
    note.documentId,
    targetContainerId,
  );
  if (!linkedDocument) {
    appData.log(
      `Explorer: failed to link note ${note.id} to container ${targetContainerId}`,
    );
    return null;
  }
  await syncExplorerDocumentLinks(appData, note.documentId, linkedDocument);

  const unlinkedDocument = await appData.apiClient.unlinkDocumentFromContainer(
    note.documentId,
    note.containerId,
  );
  if (!unlinkedDocument) {
    appData.log(
      `Explorer: note ${note.id} was linked to ${targetContainerId} but failed to unlink from ${note.containerId}`,
    );
    return null;
  }
  await syncExplorerDocumentLinks(appData, note.documentId, unlinkedDocument);

  const nextContainerId = getMovedDocumentContainerId(
    unlinkedDocument,
    targetContainerId,
  );
  if (!nextContainerId) {
    return null;
  }

  return {
    currentAccessEpoch: unlinkedDocument.currentAccessEpoch,
    linkedContainerIds: unlinkedDocument.linkedContainerIds,
    nextContainerId,
  };
}

async function syncExplorerDocumentLinks(
  appData: ReturnType<typeof useAppData>,
  documentId: string,
  document: ContainerDocumentSummary,
) {
  await appData.cacheReferencedPrincipalPolicies(
    document.referencedPrincipals ?? [],
  );
  await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
    appData.execSql,
    documentId,
    document.linkedContainerIds,
  );
}

async function linkExplorerDocument(params: {
  appData: ReturnType<typeof useAppData>;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, note, targetContainerId } = params;
  if (!note.documentId) {
    return null;
  }

  const linkedDocument = await appData.apiClient.linkDocumentToContainer(
    note.documentId,
    targetContainerId,
  );
  if (!linkedDocument) {
    appData.log(
      `Explorer: failed to link note ${note.id} to container ${targetContainerId}`,
    );
    return null;
  }

  await syncExplorerDocumentLinks(appData, note.documentId, linkedDocument);

  return linkedDocument;
}

async function unlinkExplorerDocument(params: {
  appData: ReturnType<typeof useAppData>;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, note, targetContainerId } = params;
  if (!note.documentId) {
    return null;
  }

  const unlinkedDocument = await appData.apiClient.unlinkDocumentFromContainer(
    note.documentId,
    targetContainerId,
  );
  if (!unlinkedDocument) {
    appData.log(
      `Explorer: failed to unlink note ${note.id} from container ${targetContainerId}`,
    );
    return null;
  }

  await syncExplorerDocumentLinks(appData, note.documentId, unlinkedDocument);

  return unlinkedDocument;
}

function renderTreeEntries(
  entries: ReadonlyArray<ExplorerTreeEntry>,
  depth: number,
  activeContainerId: string | null,
  collapsedIds: ReadonlySet<string>,
  documentsByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentContainerProjection>
  >,
  selectedId: string | null,
  onSelectContainer: (id: string) => void,
  onSelectDocument: (documentId: string, containerId: string) => void,
  onToggleCollapsed: (id: string) => void,
  onContextMenu: (
    event: React.MouseEvent<HTMLButtonElement>,
    id: string,
  ) => void,
): ReactNode {
  return entries.map((entry) => {
    const hasChildren = entry.children.length > 0;
    const isCollapsed = collapsedIds.has(entry.node.id);

    return (
      <Fragment key={entry.node.id}>
        <div
          className="explorer-sidebar-row"
          style={{
            paddingLeft: `calc(var(--padding) / 2 + (var(--padding) * ${depth}))`,
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="explorer-node-toggle"
              aria-label={
                isCollapsed ? "Expand container" : "Collapse container"
              }
              aria-expanded={!isCollapsed}
              onClick={() => onToggleCollapsed(entry.node.id)}
            >
              <span
                className={
                  "explorer-node-icon" +
                  (!isCollapsed ? " explorer-node-icon--expanded" : "")
                }
              >
                {"\u25B6"}
              </span>
            </button>
          ) : (
            <span className="explorer-node-spacer" aria-hidden="true" />
          )}
          <button
            type="button"
            className={
              "explorer-sidebar-item" +
              (selectedId === entry.node.id
                ? " explorer-sidebar-item--selected"
                : "")
            }
            onClick={() => onSelectContainer(entry.node.id)}
            onContextMenu={(event) => onContextMenu(event, entry.node.id)}
          >
            {entry.node.name}
          </button>
        </div>
        {!isCollapsed &&
          renderTreeEntries(
            entry.children,
            depth + 1,
            activeContainerId,
            collapsedIds,
            documentsByContainerId,
            selectedId,
            onSelectContainer,
            onSelectDocument,
            onToggleCollapsed,
            onContextMenu,
          )}
        {!isCollapsed
          ? (documentsByContainerId.get(entry.node.id) ?? []).map(
              ({ containerId, localId, title }) => (
                <div
                  className="explorer-sidebar-row"
                  key={`${localId}:${containerId}`}
                  style={{
                    paddingLeft: `calc(var(--padding) / 2 + (var(--padding) * ${depth + 1}))`,
                  }}
                >
                  <span className="explorer-node-spacer" aria-hidden="true" />
                  <button
                    type="button"
                    data-document-local-id={localId}
                    className={
                      "explorer-sidebar-item explorer-sidebar-item--note" +
                      (selectedId === localId &&
                      activeContainerId === containerId
                        ? " explorer-sidebar-item--selected"
                        : "")
                    }
                    onClick={() => onSelectDocument(localId, containerId)}
                  >
                    {title}
                  </button>
                </div>
              ),
            )
          : null}
      </Fragment>
    );
  });
}

export function buildDocumentsByContainerId(
  documentSummaries: ReadonlyArray<DocumentSummary>,
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>,
  validContainerIds: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlyArray<DocumentContainerProjection>> {
  const nextDocumentsByContainerId = new Map<
    string,
    DocumentContainerProjection[]
  >();

  for (const documentSummary of documentSummaries) {
    const linkedContainerIds = documentSummary.documentId
      ? linkedContainerIdsByDocumentId.get(documentSummary.documentId)
      : undefined;
    const fallbackContainerIds = documentSummary.containerId
      ? [documentSummary.containerId]
      : [];
    const candidateContainerIds =
      linkedContainerIds !== undefined && linkedContainerIds.length > 0
        ? linkedContainerIds
        : fallbackContainerIds;

    if (candidateContainerIds.length === 0) {
      continue;
    }

    for (const containerId of candidateContainerIds) {
      if (!validContainerIds.has(containerId)) {
        continue;
      }

      const existingDocuments =
        nextDocumentsByContainerId.get(containerId) ?? [];
      existingDocuments.push({
        containerId,
        localId: documentSummary.id,
        title: documentSummary.title,
        updatedAt: documentSummary.updatedAt,
      });
      nextDocumentsByContainerId.set(containerId, existingDocuments);
    }
  }

  for (const documents of nextDocumentsByContainerId.values()) {
    documents.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  return nextDocumentsByContainerId;
}

function getKnownDocumentIds(
  documentSummaries: ReadonlyArray<DocumentSummary>,
): ReadonlySet<string> {
  return new Set(
    documentSummaries.flatMap((note) =>
      note.documentId ? [note.documentId] : [],
    ),
  );
}

function mergeSingleDocumentSummaryList(
  currentDocumentSummaries: ReadonlyArray<DocumentSummary>,
  nextDocument: DocumentSummary,
): ReadonlyArray<DocumentSummary> {
  const existingDocumentIndex = currentDocumentSummaries.findIndex(
    (note) => note.id === nextDocument.id,
  );

  if (existingDocumentIndex < 0) {
    return [...currentDocumentSummaries, nextDocument];
  }

  const existingDocument = currentDocumentSummaries[existingDocumentIndex];
  if (!existingDocument) {
    return currentDocumentSummaries;
  }

  if (
    existingDocument.title === nextDocument.title &&
    existingDocument.containerId === nextDocument.containerId &&
    existingDocument.documentKind === nextDocument.documentKind &&
    existingDocument.documentId === nextDocument.documentId
  ) {
    return currentDocumentSummaries;
  }

  const nextDocumentSummaries = [...currentDocumentSummaries];
  nextDocumentSummaries[existingDocumentIndex] = nextDocument;
  return nextDocumentSummaries;
}

function getRequestedDocumentIds(
  documentSummaries: ReadonlyArray<DocumentSummary>,
): ReadonlyArray<string> {
  return Array.from(
    new Set(
      documentSummaries.flatMap((note) =>
        note.documentId ? [note.documentId] : [],
      ),
    ),
  ).sort();
}

function areLinkedContainerIdMapsEqual(
  left: ReadonlyMap<string, ReadonlyArray<string>>,
  right: ReadonlyMap<string, ReadonlyArray<string>>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const [documentId, leftContainerIds] of left) {
    const rightContainerIds = right.get(documentId);
    if (
      !rightContainerIds ||
      leftContainerIds.length !== rightContainerIds.length
    ) {
      return false;
    }

    if (
      leftContainerIds.some(
        (containerId, index) => containerId !== rightContainerIds[index],
      )
    ) {
      return false;
    }
  }

  return true;
}

function mergeDocumentSummaryLists(
  currentDocumentSummaries: ReadonlyArray<DocumentSummary>,
  nextDocuments: ReadonlyArray<DocumentSummary>,
): ReadonlyArray<DocumentSummary> {
  if (nextDocuments.length === 0) {
    return currentDocumentSummaries;
  }

  let changed = false;
  const nextDocumentSummaries = [...currentDocumentSummaries];

  for (const nextDocument of nextDocuments) {
    const existingDocumentIndex = nextDocumentSummaries.findIndex(
      (note) => note.id === nextDocument.id,
    );

    if (existingDocumentIndex < 0) {
      nextDocumentSummaries.push(nextDocument);
      changed = true;
      continue;
    }

    const existingDocument = nextDocumentSummaries[existingDocumentIndex];
    if (
      !existingDocument ||
      (existingDocument.title === nextDocument.title &&
        existingDocument.containerId === nextDocument.containerId &&
        existingDocument.documentKind === nextDocument.documentKind &&
        existingDocument.documentId === nextDocument.documentId)
    ) {
      continue;
    }

    nextDocumentSummaries[existingDocumentIndex] = nextDocument;
    changed = true;
  }

  return changed ? nextDocumentSummaries : currentDocumentSummaries;
}

async function primeExplorerDocumentStoreForStructuralMutation(params: {
  appData: ReturnType<typeof useAppData>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  note: DocumentSummary;
}) {
  const { appData, mergeDocumentSummary, note } = params;
  if (!note.containerId || !note.documentId) {
    return null;
  }

  const documentStore = primeDocumentStore(
    appData.domainScope,
    note.id,
    createExplorerDocumentsRuntime(appData, note.containerId),
    mergeDocumentSummary,
    note.documentId,
  );
  if (!(await documentStore.ensureInitialized())) {
    appData.log(`Explorer: note ${note.id} is not ready to mutate locally`);
    return null;
  }

  return documentStore;
}

function useExplorerSelection(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (nodes.length === 0) {
      setSelectedId(null);
      return;
    }

    const selectedMatchesContainer = nodes.some(
      (node) => node.id === selectedId,
    );
    const selectedMatchesNote = documentSummaries.some(
      (note) => note.id === selectedId,
    );

    if (!selectedId || (!selectedMatchesContainer && !selectedMatchesNote)) {
      setSelectedId(nodes[0]?.id ?? null);
    }
  }, [nodes, documentSummaries, selectedId]);

  useEffect(() => {
    setCollapsedIds((currentIds) => {
      const validIds = new Set(nodes.map((node) => node.id));
      let changed = false;
      const nextIds = new Set<string>();

      for (const id of currentIds) {
        if (validIds.has(id)) {
          nextIds.add(id);
        } else {
          changed = true;
        }
      }

      return changed ? nextIds : currentIds;
    });
  }, [nodes]);

  const toggleCollapsed = useCallback((nodeId: string) => {
    setCollapsedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(nodeId)) {
        nextIds.delete(nodeId);
      } else {
        nextIds.add(nodeId);
      }
      return nextIds;
    });
  }, []);

  const expandNode = useCallback((nodeId: string) => {
    setCollapsedIds((currentIds) => {
      if (!currentIds.has(nodeId)) {
        return currentIds;
      }

      const nextIds = new Set(currentIds);
      nextIds.delete(nodeId);
      return nextIds;
    });
  }, []);

  const selectedNode = nodes.find((node) => node.id === selectedId);
  const selectedDocument = documentSummaries.find(
    (note) => note.id === selectedId,
  );

  return {
    activeContainerId:
      selectedDocument?.containerId ?? selectedNode?.id ?? null,
    collapsedIds,
    expandNode,
    selectedId,
    selectedNode,
    selectedDocument,
    setSelectedId,
    toggleCollapsed,
  };
}

function useExplorerDocumentSummaryState(
  dbStatus: ReturnType<typeof useAppData>["dbStatus"],
  domainScope: ReturnType<typeof useAppData>["domainScope"],
  execSql: ReturnType<typeof useAppData>["execSql"],
  nodes: ReadonlyArray<ContainerNode>,
) {
  const [documentSummaries, setDocumentSummaries] = useState<
    ReadonlyArray<DocumentSummary>
  >([]);

  useEffect(() => {
    if (dbStatus !== "ready") {
      setDocumentSummaries([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      await sqlDocumentContainerProjectionPersistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const storedDocuments =
        await sqlDocumentsPersistence.listDocuments(execSql);
      const validContainerIds = new Set(nodes.map((node) => node.id));
      const visibleDocuments = storedDocuments.filter(
        (documentSummary) =>
          documentSummary.containerId &&
          validContainerIds.has(documentSummary.containerId),
      );

      if (!cancelled) {
        setDocumentSummaries((currentDocumentSummaries) => {
          const visibleDocumentsById = new Map(
            visibleDocuments.map((documentSummary) => [
              documentSummary.id,
              documentSummary,
            ]),
          );
          const pendingVisibleDocuments = currentDocumentSummaries.filter(
            (documentSummary) =>
              documentSummary.containerId &&
              validContainerIds.has(documentSummary.containerId) &&
              !visibleDocumentsById.has(documentSummary.id),
          );

          return [...visibleDocuments, ...pendingVisibleDocuments];
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dbStatus, domainScope, execSql, nodes]);

  const mergeDocumentSummary = useCallback((nextDocument: DocumentSummary) => {
    setDocumentSummaries((currentDocumentSummaries) =>
      mergeSingleDocumentSummaryList(currentDocumentSummaries, nextDocument),
    );
  }, []);

  const mergeDocumentSummaries = useCallback(
    (nextDocuments: ReadonlyArray<DocumentSummary>) => {
      setDocumentSummaries((currentDocumentSummaries) =>
        mergeDocumentSummaryLists(currentDocumentSummaries, nextDocuments),
      );
    },
    [],
  );

  useEffect(() => {
    return subscribeToPersistedDocuments(domainScope, mergeDocumentSummary);
  }, [domainScope, mergeDocumentSummary]);

  return { mergeDocumentSummaries, mergeDocumentSummary, documentSummaries };
}

function useDocumentLinkedContainerIdsByDocumentId(params: {
  dbStatus: ReturnType<typeof useAppData>["dbStatus"];
  documentLinkProjectionVersion: number;
  execSql: ReturnType<typeof useAppData>["execSql"];
  documentSummaries: ReadonlyArray<DocumentSummary>;
}) {
  const {
    dbStatus,
    documentLinkProjectionVersion,
    execSql,
    documentSummaries,
  } = params;
  const [linkedContainerIdsByDocumentId, setLinkedContainerIdsByDocumentId] =
    useState<ReadonlyMap<string, ReadonlyArray<string>>>(new Map());
  const linkedContainerIdsLoadVersionRef = useRef(0);
  const requestedDocumentIds = useMemo(
    () => getRequestedDocumentIds(documentSummaries),
    [documentSummaries],
  );
  const requestedDocumentIdsKey = requestedDocumentIds.join("\u0000");
  const setLinkedContainerIdsForDocument = useCallback(
    (documentId: string, linkedContainerIds: ReadonlyArray<string>) => {
      setLinkedContainerIdsByDocumentId((currentMap) => {
        const nextLinkedContainerIds = Array.from(
          new Set(linkedContainerIds),
        ).sort();
        const currentLinkedContainerIds = currentMap.get(documentId);
        if (
          currentLinkedContainerIds &&
          currentLinkedContainerIds.length === nextLinkedContainerIds.length &&
          currentLinkedContainerIds.every(
            (containerId, index) =>
              containerId === nextLinkedContainerIds[index],
          )
        ) {
          return currentMap;
        }

        const nextMap = new Map(currentMap);
        nextMap.set(documentId, nextLinkedContainerIds);
        return nextMap;
      });
    },
    [],
  );

  useEffect(() => {
    if (dbStatus !== "ready" || requestedDocumentIds.length === 0) {
      setLinkedContainerIdsByDocumentId(new Map());
      return;
    }

    let cancelled = false;
    const loadVersion = linkedContainerIdsLoadVersionRef.current + 1;
    linkedContainerIdsLoadVersionRef.current = loadVersion;
    void (async () => {
      try {
        const nextLinkedContainerIdsByDocumentId =
          await sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
            execSql,
            requestedDocumentIds,
          );
        if (
          !cancelled &&
          linkedContainerIdsLoadVersionRef.current === loadVersion
        ) {
          setLinkedContainerIdsByDocumentId((currentMap) =>
            areLinkedContainerIdMapsEqual(
              currentMap,
              nextLinkedContainerIdsByDocumentId,
            )
              ? currentMap
              : nextLinkedContainerIdsByDocumentId,
          );
        }
      } catch (error: unknown) {
        if (!cancelled && !isDestroyedDatabaseWorkerError(error)) {
          console.error(
            "Explorer: failed to load linked container projections:",
            error,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    dbStatus,
    documentLinkProjectionVersion,
    execSql,
    requestedDocumentIdsKey,
  ]);

  return { linkedContainerIdsByDocumentId, setLinkedContainerIdsForDocument };
}
function useExplorerRefreshAction(params: {
  appData: Pick<
    ReturnType<typeof useAppData>,
    "apiClient" | "cacheReferencedPrincipalPolicies" | "execSql"
  >;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  primeDiscoveredDocuments: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  replaceDocumentLinksBatch: (
    inputs: ReadonlyArray<{
      containerIds: ReadonlyArray<string>;
      documentId: string;
    }>,
  ) => Promise<void>;
  refresh: () => Promise<boolean>;
}) {
  const {
    appData,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
  } = params;
  const { apiClient, cacheReferencedPrincipalPolicies, execSql } = appData;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    setRefreshError(null);
    setIsRefreshing(true);

    try {
      const refreshed = await refresh();
      if (!refreshed) {
        setRefreshError("Refresh unavailable.");
        return;
      }

      const remoteContainers = await apiClient.listContainers();
      if (!remoteContainers) {
        setRefreshError("Failed to refresh documents.");
        return;
      }

      const discoveredDocumentSummaries = await discoverAllContainerDocuments({
        cacheReferencedPrincipalPolicies,
        containerIds: remoteContainers.map((container) => container.id),
        listContainerDocuments: (containerId) =>
          apiClient.listContainerDocuments(containerId),
        replaceDocumentLinksBatch,
        upsertDiscoveredDocuments: (inputs) =>
          upsertDiscoveredDocuments(execSql, inputs),
      });

      mergeDocumentSummaries(discoveredDocumentSummaries);
      primeDiscoveredDocuments(discoveredDocumentSummaries);
    } catch (error: unknown) {
      if (!isDestroyedDatabaseWorkerError(error)) {
        console.error("Failed to refresh explorer:", error);
        setRefreshError("Failed to refresh explorer.");
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [
    apiClient,
    cacheReferencedPrincipalPolicies,
    execSql,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
  ]);

  return { handleRefresh, isRefreshing, refreshError };
}

function useExplorerSidebarPanel(params: {
  activeContainerId: string | null;
  collapsedIds: ReadonlySet<string>;
  handleSidebarContextMenu: (
    event: React.MouseEvent<HTMLButtonElement>,
    nodeId: string,
  ) => void;
  documentsByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentContainerProjection>
  >;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
  selectedId: string | null;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  setSidebar: (sidebar: ReactNode | null) => void;
  toggleCollapsed: (nodeId: string) => void;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    activeContainerId,
    collapsedIds,
    handleSidebarContextMenu,
    documentsByContainerId,
    nodes,
    ready,
    selectedId,
    selectDocumentProjection,
    setSelectedId,
    setSidebar,
    toggleCollapsed,
    treeEntries,
  } = params;

  const sidebar = useMemo(
    () => (
      <div className="explorer-sidebar">
        {!ready ? (
          <div className="explorer-hint">Loading...</div>
        ) : nodes.length === 0 ? (
          <div className="explorer-hint">No containers.</div>
        ) : (
          renderTreeEntries(
            treeEntries,
            0,
            activeContainerId,
            collapsedIds,
            documentsByContainerId,
            selectedId,
            setSelectedId,
            selectDocumentProjection,
            toggleCollapsed,
            handleSidebarContextMenu,
          )
        )}
      </div>
    ),
    [
      activeContainerId,
      collapsedIds,
      handleSidebarContextMenu,
      nodes.length,
      documentsByContainerId,
      ready,
      selectedId,
      selectDocumentProjection,
      setSelectedId,
      toggleCollapsed,
      treeEntries,
    ],
  );

  useEffect(() => {
    setSidebar(sidebar);
    return () => setSidebar(null);
  }, [setSidebar, sidebar]);
}

function useInlineDocumentAction(params: {
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  setSelectedId: (id: string | null) => void;
}): OpenInlineDocument {
  const { expandNode, mergeDocumentSummary, setSelectedId } = params;

  return useCallback(
    (
      containerId: string,
      documentKind: StoredDocumentKind,
      localId?: string,
    ) => {
      const nextLocalId = localId ?? crypto.randomUUID();

      if (!localId) {
        mergeDocumentSummary({
          id: nextLocalId,
          containerId,
          documentKind,
          documentId: null,
          title: getUntitledDocumentTitle(documentKind),
          updatedAt: new Date().toISOString(),
        });
      }

      setSelectedId(nextLocalId);
      expandNode(containerId);
    },
    [expandNode, mergeDocumentSummary, setSelectedId],
  );
}

function useExplorerDocumentModalState(params: {
  explorer: ReturnType<typeof useExplorer>;
  linkDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  moveDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  peerUserId: string | null;
  selectedId: (id: string | null) => void;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectionExpandNode: (nodeId: string) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const {
    explorer,
    linkDocument,
    moveDocument,
    documentSummaries,
    peerUserId,
    selectedId,
    selectedDocumentLinkedContainerIds,
    selectionExpandNode,
    shareWithUser,
  } = params;

  return useExplorerModalController({
    createChild: explorer.createChild,
    deleteContainer: explorer.deleteContainer,
    expandNode: selectionExpandNode,
    linkDocument,
    moveContainer: explorer.moveContainer,
    moveDocument,
    nodes: explorer.nodes,
    documentSummaries,
    peerUserId,
    renameContainer: explorer.renameContainer,
    selectedDocumentLinkedContainerIds,
    setSelectedId: selectedId,
    shareWithUser,
  });
}

async function moveExplorerNote(params: {
  appData: ReturnType<typeof useAppData>;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  note: DocumentSummary;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
  targetContainerId: string;
}) {
  const {
    appData,
    expandNode,
    mergeDocumentSummary,
    note,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  } = params;
  if (
    !note.documentId ||
    !note.containerId ||
    note.containerId === targetContainerId
  ) {
    return null;
  }

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      appData,
      mergeDocumentSummary,
      note,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const movedDocument = await moveExplorerDocument({
    appData,
    note,
    targetContainerId,
  });
  if (!movedDocument) {
    return null;
  }
  const { currentAccessEpoch, linkedContainerIds, nextContainerId } =
    movedDocument;
  setLinkedContainerIdsForDocument(note.documentId, linkedContainerIds);

  const movedNote = await relinkExplorerNoteAfterStructuralMutation({
    accessEpoch: currentAccessEpoch,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    targetContainerId: nextContainerId,
  });
  if (!movedNote) {
    return null;
  }

  expandNode(nextContainerId);
  appData.log(`Explorer: moved note ${movedNote.id} to ${nextContainerId}`);
  return movedNote;
}

async function linkExplorerNote(params: {
  appData: ReturnType<typeof useAppData>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  note: DocumentSummary;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
  targetContainerId: string;
}) {
  const {
    appData,
    mergeDocumentSummary,
    note,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  } = params;
  if (!note.documentId || !note.containerId) {
    return null;
  }

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      appData,
      mergeDocumentSummary,
      note,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const linkedDocument = await linkExplorerDocument({
    appData,
    note,
    targetContainerId,
  });
  if (!linkedDocument) {
    return null;
  }
  setLinkedContainerIdsForDocument(
    note.documentId,
    linkedDocument.linkedContainerIds,
  );

  const linkedNote = await relinkExplorerNoteAfterStructuralMutation({
    accessEpoch: linkedDocument.currentAccessEpoch,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    targetContainerId: note.containerId,
  });
  if (!linkedNote) {
    return null;
  }

  appData.log(`Explorer: linked note ${linkedNote.id} to ${targetContainerId}`);
  return linkedNote;
}

async function unlinkExplorerLinkedNote(params: {
  appData: ReturnType<typeof useAppData>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  note: DocumentSummary;
  removedContainerId: string;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
}) {
  const {
    appData,
    mergeDocumentSummary,
    note,
    removedContainerId,
    setLinkedContainerIdsForDocument,
  } = params;
  if (!note.documentId || !note.containerId) {
    return null;
  }

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      appData,
      mergeDocumentSummary,
      note,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const unlinkedDocument = await unlinkExplorerDocument({
    appData,
    note,
    targetContainerId: removedContainerId,
  });
  if (!unlinkedDocument) {
    return null;
  }
  setLinkedContainerIdsForDocument(
    note.documentId,
    unlinkedDocument.linkedContainerIds,
  );

  const nextContainerId = getMovedDocumentContainerId(
    unlinkedDocument,
    note.containerId,
  );
  if (!nextContainerId) {
    appData.log(
      `Explorer: note ${note.id} has no remaining linked containers after unlink`,
    );
    return null;
  }

  const unlinkedNote = await relinkExplorerNoteAfterStructuralMutation({
    accessEpoch: unlinkedDocument.currentAccessEpoch,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    targetContainerId: nextContainerId,
  });
  if (!unlinkedNote) {
    return null;
  }

  appData.log(
    `Explorer: unlinked note ${unlinkedNote.id} from ${removedContainerId}`,
  );
  return unlinkedNote;
}

async function activateExplorerLinkedNote(params: {
  appData: ReturnType<typeof useAppData>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, mergeDocumentSummary, note, targetContainerId } = params;
  if (
    !note.documentId ||
    !note.containerId ||
    note.containerId === targetContainerId
  ) {
    return null;
  }

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      appData,
      mergeDocumentSummary,
      note,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const relinkedNote = await relinkExplorerNoteLocally({
    accessEpoch: 1,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    requestSync: false,
    targetContainerId,
  });
  if (!relinkedNote) {
    return null;
  }

  appData.log(
    `Explorer: switched active note ${relinkedNote.id} to ${targetContainerId}`,
  );
  return relinkedNote;
}

async function relinkExplorerNoteAfterStructuralMutation(params: {
  accessEpoch: number;
  appData: ReturnType<typeof useAppData>;
  currentDocumentStore: ReturnType<typeof primeDocumentStore>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  return relinkExplorerNoteLocally({
    ...params,
    requestSync: true,
  });
}

async function relinkExplorerNoteLocally(params: {
  accessEpoch: number;
  appData: ReturnType<typeof useAppData>;
  currentDocumentStore: ReturnType<typeof primeDocumentStore>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  note: DocumentSummary;
  requestSync: boolean;
  targetContainerId: string;
}) {
  const {
    accessEpoch,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    requestSync,
    targetContainerId,
  } = params;
  if (!note.documentId) {
    return null;
  }

  const relinkedNote = await currentDocumentStore.relink({
    accessEpoch,
    containerId: targetContainerId,
    documentId: note.documentId,
    localId: note.id,
  });
  if (!relinkedNote) {
    appData.log(
      `Explorer: note ${note.id} could not be relinked after a structural mutation`,
    );
    return null;
  }

  mergeDocumentSummary(relinkedNote);
  currentDocumentStore.updateRuntime(
    createExplorerDocumentsRuntime(appData, targetContainerId),
  );
  if (requestSync) {
    currentDocumentStore.requestSync();
  }
  return relinkedNote;
}

function useMoveDocumentAction(params: {
  appData: ReturnType<typeof useAppData>;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
}) {
  const {
    appData,
    expandNode,
    mergeDocumentSummary,
    documentSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (
        appData.dbStatus !== "ready" ||
        !appData.isAuthenticated ||
        !appData.online
      ) {
        return null;
      }

      const existingDocument = documentSummaries.find(
        (note) => note.id === noteId,
      );
      if (!existingDocument) {
        return null;
      }

      const movedNote = await moveExplorerNote({
        appData,
        expandNode,
        mergeDocumentSummary,
        note: existingDocument,
        setLinkedContainerIdsForDocument,
        targetContainerId,
      });
      if (movedNote) {
        onDocumentLinksChanged();
      }

      return movedNote;
    },
    [
      appData,
      expandNode,
      mergeDocumentSummary,
      documentSummaries,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useLinkDocumentAction(params: {
  appData: ReturnType<typeof useAppData>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
}) {
  const {
    appData,
    mergeDocumentSummary,
    documentSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (
        appData.dbStatus !== "ready" ||
        !appData.isAuthenticated ||
        !appData.online
      ) {
        return null;
      }

      const existingDocument = documentSummaries.find(
        (note) => note.id === noteId,
      );
      if (!existingDocument) {
        return null;
      }

      const linkedNote = await linkExplorerNote({
        appData,
        mergeDocumentSummary,
        note: existingDocument,
        setLinkedContainerIdsForDocument,
        targetContainerId,
      });
      if (linkedNote) {
        onDocumentLinksChanged();
      }

      return linkedNote;
    },
    [
      appData,
      mergeDocumentSummary,
      documentSummaries,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useUnlinkDocumentAction(params: {
  appData: ReturnType<typeof useAppData>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
}) {
  const {
    appData,
    mergeDocumentSummary,
    documentSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (noteId: string, removedContainerId: string) => {
      if (
        appData.dbStatus !== "ready" ||
        !appData.isAuthenticated ||
        !appData.online
      ) {
        return null;
      }

      const existingDocument = documentSummaries.find(
        (note) => note.id === noteId,
      );
      if (!existingDocument) {
        return null;
      }

      const unlinkedNote = await unlinkExplorerLinkedNote({
        appData,
        mergeDocumentSummary,
        note: existingDocument,
        removedContainerId,
        setLinkedContainerIdsForDocument,
      });
      if (unlinkedNote) {
        onDocumentLinksChanged();
      }

      return unlinkedNote;
    },
    [
      appData,
      mergeDocumentSummary,
      documentSummaries,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useActivateLinkedDocumentAction(params: {
  appData: ReturnType<typeof useAppData>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  documentSummaries: ReadonlyArray<DocumentSummary>;
}) {
  const { appData, mergeDocumentSummary, documentSummaries } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (appData.dbStatus !== "ready") {
        return null;
      }

      const existingDocument = documentSummaries.find(
        (note) => note.id === noteId,
      );
      if (!existingDocument) {
        return null;
      }

      return activateExplorerLinkedNote({
        appData,
        mergeDocumentSummary,
        note: existingDocument,
        targetContainerId,
      });
    },
    [appData, mergeDocumentSummary, documentSummaries],
  );
}

function useExplorerDocumentViewModel(
  appData: ReturnType<typeof useAppData>,
  explorer: ReturnType<typeof useExplorer>,
  documentLinkProjectionVersion: number,
) {
  const { mergeDocumentSummaries, mergeDocumentSummary, documentSummaries } =
    useExplorerDocumentSummaryState(
      appData.dbStatus,
      appData.domainScope,
      appData.execSql,
      explorer.nodes,
    );
  const { linkedContainerIdsByDocumentId, setLinkedContainerIdsForDocument } =
    useDocumentLinkedContainerIdsByDocumentId({
      dbStatus: appData.dbStatus,
      documentLinkProjectionVersion,
      execSql: appData.execSql,
      documentSummaries,
    });
  const validContainerIds = useMemo(
    () => new Set(explorer.nodes.map((node) => node.id)),
    [explorer.nodes],
  );
  const documentsByContainerId = useMemo(
    () =>
      buildDocumentsByContainerId(
        documentSummaries,
        linkedContainerIdsByDocumentId,
        validContainerIds,
      ),
    [linkedContainerIdsByDocumentId, documentSummaries, validContainerIds],
  );
  const knownDocumentIds = useMemo(
    () => getKnownDocumentIds(documentSummaries),
    [documentSummaries],
  );
  const selection = useExplorerSelection(explorer.nodes, documentSummaries);

  return {
    knownDocumentIds,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    documentSummaries,
    documentsByContainerId,
    selection,
    setLinkedContainerIdsForDocument,
  };
}

function getSelectedDocumentLinkedContainerIds(params: {
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  selectedDocument: DocumentSummary | undefined;
}) {
  const { linkedContainerIdsByDocumentId, selectedDocument } = params;
  if (!selectedDocument) {
    return [];
  }

  const fallbackContainerIds =
    selectedDocument.containerId === null ? [] : [selectedDocument.containerId];
  if (!selectedDocument.documentId) {
    return fallbackContainerIds;
  }

  const linkedContainerIds =
    linkedContainerIdsByDocumentId.get(selectedDocument.documentId) ?? [];
  return linkedContainerIds.length > 0
    ? linkedContainerIds
    : fallbackContainerIds;
}

function useExplorerInteractionState(params: {
  activeContainerId: string | null;
  appData: ReturnType<typeof useAppData>;
  explorer: ReturnType<typeof useExplorer>;
  knownDocumentIds: ReadonlySet<string>;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  onDocumentLinksChanged: () => void;
}) {
  const {
    activeContainerId,
    appData,
    explorer,
    knownDocumentIds,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    onDocumentLinksChanged,
  } = params;
  const replaceDocumentLinksBatch = useCallback(
    async (
      inputs: ReadonlyArray<{
        containerIds: ReadonlyArray<string>;
        documentId: string;
      }>,
    ) => {
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
        appData.execSql,
        inputs,
      );
      onDocumentLinksChanged();
    },
    [appData.execSql, onDocumentLinksChanged],
  );
  const { primeDiscoveredDocuments } = useDiscoveredDocumentsSync({
    activeContainerId,
    appData,
    knownDocumentIds,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    replaceDocumentLinksBatch,
  });

  return useExplorerRefreshAction({
    appData,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh: explorer.refresh,
  });
}

function useSelectedDocumentTargetOptions(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocument: DocumentSummary | undefined;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
}) {
  const {
    documentSummaries,
    nodes,
    selectedDocument,
    selectedDocumentLinkedContainerIds,
  } = params;
  const targetLookups = useMemo(
    () => createExplorerTargetLookups(nodes, documentSummaries),
    [documentSummaries, nodes],
  );
  const selectedDocumentMoveTargetOptions = useMemo(
    () =>
      selectedDocument
        ? getDocumentMoveTargetOptions(
            nodes,
            documentSummaries,
            selectedDocument.id,
            targetLookups,
          )
        : [],
    [documentSummaries, nodes, selectedDocument, targetLookups],
  );
  const selectedDocumentLinkTargetOptions = useMemo(
    () =>
      selectedDocument
        ? getDocumentLinkTargetOptions(
            nodes,
            documentSummaries,
            selectedDocument.id,
            selectedDocumentLinkedContainerIds,
            targetLookups,
          )
        : [],
    [
      documentSummaries,
      nodes,
      selectedDocument,
      selectedDocumentLinkedContainerIds,
      targetLookups,
    ],
  );

  return {
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
  };
}

function useSelectedDocumentStructuralState(params: {
  appData: ReturnType<typeof useAppData>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
  selectedDocument: DocumentSummary | undefined;
  expandNode: (nodeId: string) => void;
}) {
  const {
    appData,
    expandNode,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummary,
    nodes,
    documentSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
    selectedDocument,
  } = params;
  const selectedDocumentLinkedContainerIds =
    getSelectedDocumentLinkedContainerIds({
      linkedContainerIdsByDocumentId,
      selectedDocument,
    });
  const moveDocument = useMoveDocumentAction({
    appData,
    expandNode,
    mergeDocumentSummary,
    documentSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const activateLinkedDocument = useActivateLinkedDocumentAction({
    appData,
    mergeDocumentSummary,
    documentSummaries,
  });
  const linkDocument = useLinkDocumentAction({
    appData,
    mergeDocumentSummary,
    documentSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const unlinkDocument = useUnlinkDocumentAction({
    appData,
    mergeDocumentSummary,
    documentSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const {
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
  } = useSelectedDocumentTargetOptions({
    documentSummaries,
    nodes,
    selectedDocument,
    selectedDocumentLinkedContainerIds,
  });

  return {
    activateLinkedDocument,
    linkDocument,
    moveDocument,
    selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
    unlinkDocument,
  };
}

function useSelectDocumentProjection(params: {
  activateLinkedDocument: (
    noteId: string,
    containerId: string,
  ) => Promise<DocumentSummary | null>;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  setSelectedId: (id: string | null) => void;
}) {
  const { activateLinkedDocument, documentSummaries, setSelectedId } = params;

  return useCallback(
    (noteId: string, containerId: string) => {
      setSelectedId(noteId);
      const existingDocument = documentSummaries.find(
        (note) => note.id === noteId,
      );
      if (!existingDocument || existingDocument.containerId === containerId) {
        return;
      }

      void activateLinkedDocument(noteId, containerId);
    },
    [activateLinkedDocument, documentSummaries, setSelectedId],
  );
}

function useExplorerPanelState(params: {
  appData: ReturnType<typeof useAppData>;
  explorer: ReturnType<typeof useExplorer>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  documentsByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentContainerProjection>
  >;
  onDocumentLinksChanged: () => void;
  peerUserId: string | null;
  selection: ReturnType<typeof useExplorerSelection>;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
  setSidebar: (sidebar: ReactNode | null) => void;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    appData,
    explorer,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummary,
    documentSummaries,
    documentsByContainerId,
    onDocumentLinksChanged,
    peerUserId,
    selection,
    setLinkedContainerIdsForDocument,
    setSidebar,
    treeEntries,
  } = params;
  const contextMenuState = useExplorerContextMenu(
    explorer.nodes,
    selection.setSelectedId,
  );
  const selectedNoteStructuralState = useSelectedDocumentStructuralState({
    appData,
    expandNode: selection.expandNode,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummary,
    nodes: explorer.nodes,
    documentSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
    selectedDocument: selection.selectedDocument,
  });
  const selectDocumentProjection = useSelectDocumentProjection({
    activateLinkedDocument: selectedNoteStructuralState.activateLinkedDocument,
    documentSummaries,
    setSelectedId: selection.setSelectedId,
  });
  useExplorerSidebarPanel({
    activeContainerId: selection.activeContainerId,
    collapsedIds: selection.collapsedIds,
    handleSidebarContextMenu: contextMenuState.handleSidebarContextMenu,
    documentsByContainerId,
    nodes: explorer.nodes,
    ready: explorer.ready,
    selectedId: selection.selectedId,
    selectDocumentProjection,
    setSelectedId: selection.setSelectedId,
    setSidebar,
    toggleCollapsed: selection.toggleCollapsed,
    treeEntries,
  });
  const modalState = useExplorerDocumentModalState({
    explorer,
    linkDocument: selectedNoteStructuralState.linkDocument,
    moveDocument: selectedNoteStructuralState.moveDocument,
    documentSummaries,
    peerUserId,
    selectedId: selection.setSelectedId,
    selectedDocumentLinkedContainerIds:
      selectedNoteStructuralState.selectedDocumentLinkedContainerIds,
    selectionExpandNode: selection.expandNode,
    shareWithUser: explorer.shareWithUser,
  });
  const openInlineDocument = useInlineDocumentAction({
    expandNode: selection.expandNode,
    mergeDocumentSummary,
    setSelectedId: selection.setSelectedId,
  });
  return {
    activateLinkedContainer: selectedNoteStructuralState.activateLinkedDocument,
    contextMenuState,
    modalState,
    openInlineDocument,
    selectedDocumentLinkedContainerIds:
      selectedNoteStructuralState.selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions:
      selectedNoteStructuralState.selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions:
      selectedNoteStructuralState.selectedDocumentMoveTargetOptions,
    unlinkDocument: selectedNoteStructuralState.unlinkDocument,
  };
}

function useDocumentLinkProjectionVersion() {
  const [documentLinkProjectionVersion, setDocumentLinkProjectionVersion] =
    useState(0);
  const handleDocumentLinksChanged = useCallback(() => {
    setDocumentLinkProjectionVersion((currentVersion) => currentVersion + 1);
  }, []);

  return {
    documentLinkProjectionVersion,
    handleDocumentLinksChanged,
  };
}

function getSelectedDocumentMutationState(params: {
  appData: ReturnType<typeof useAppData>;
  selectedDocument: DocumentSummary | undefined;
  selectedDocumentLinkTargetOptions: ReadonlyArray<MoveTargetOption>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectedDocumentMoveTargetOptions: ReadonlyArray<MoveTargetOption>;
}) {
  const {
    appData,
    selectedDocument,
    selectedDocumentLinkTargetOptions,
    selectedDocumentLinkedContainerIds,
    selectedDocumentMoveTargetOptions,
  } = params;
  const canActivateSelectedDocument =
    appData.dbStatus === "ready" && !!selectedDocument?.documentId;
  const canMutateSelectedDocument =
    canActivateSelectedDocument && appData.isAuthenticated && appData.online;

  return {
    canActivateSelectedDocument,
    canLinkSelectedDocument:
      canMutateSelectedDocument && selectedDocumentLinkTargetOptions.length > 0,
    canMoveSelectedDocument:
      canMutateSelectedDocument && selectedDocumentMoveTargetOptions.length > 0,
    canUnlinkSelectedDocument:
      canMutateSelectedDocument &&
      selectedDocumentLinkedContainerIds.length > 1,
  };
}

function useExplorerModel(
  appData: ReturnType<typeof useAppData>,
  explorer: ReturnType<typeof useExplorer>,
  setSidebar: (sidebar: ReactNode | null) => void,
  peerUserId: string | null,
) {
  const { documentLinkProjectionVersion, handleDocumentLinksChanged } =
    useDocumentLinkProjectionVersion();
  const {
    knownDocumentIds,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    documentSummaries,
    documentsByContainerId,
    selection,
    setLinkedContainerIdsForDocument,
  } = useExplorerDocumentViewModel(
    appData,
    explorer,
    documentLinkProjectionVersion,
  );
  const treeEntries = useMemo(
    () => buildExplorerTree(explorer.nodes),
    [explorer.nodes],
  );
  const { handleRefresh, isRefreshing, refreshError } =
    useExplorerInteractionState({
      activeContainerId: selection.activeContainerId,
      appData,
      explorer,
      knownDocumentIds,
      mergeDocumentSummaries,
      mergeDocumentSummary,
      onDocumentLinksChanged: handleDocumentLinksChanged,
    });
  const {
    activateLinkedContainer,
    contextMenuState,
    modalState,
    openInlineDocument,
    selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
    unlinkDocument,
  } = useExplorerPanelState({
    appData,
    explorer,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummary,
    documentSummaries,
    documentsByContainerId,
    onDocumentLinksChanged: handleDocumentLinksChanged,
    peerUserId,
    selection,
    setLinkedContainerIdsForDocument,
    setSidebar,
    treeEntries,
  });
  const selectedDocumentMutationState = getSelectedDocumentMutationState({
    appData,
    selectedDocument: selection.selectedDocument,
    selectedDocumentLinkTargetOptions,
    selectedDocumentLinkedContainerIds,
    selectedDocumentMoveTargetOptions,
  });

  return {
    activateLinkedContainer,
    ...selectedDocumentMutationState,
    contextMenuState,
    explorer,
    handleRefresh,
    isRefreshing,
    linkedContainerIds: selectedDocumentLinkedContainerIds,
    mergeDocumentSummary,
    modalState,
    openInlineDocument,
    peerUserId,
    refreshError,
    selection,
    unlinkDocument,
  };
}

export function Explorer() {
  const appData = useAppData();
  const explorer = useExplorer();
  const { setSidebar } = useWindowSidebar();
  const peerUserId = usePeerUserId();
  const model = useExplorerModel(appData, explorer, setSidebar, peerUserId);

  return (
    <div className="explorer">
      <ExplorerDetailPanel
        activateLinkedContainer={model.activateLinkedContainer}
        canActivateSelectedDocument={model.canActivateSelectedDocument}
        canLinkSelectedDocument={model.canLinkSelectedDocument}
        canMoveSelectedDocument={model.canMoveSelectedDocument}
        canUnlinkSelectedDocument={model.canUnlinkSelectedDocument}
        handleRefresh={model.handleRefresh}
        isRefreshing={model.isRefreshing}
        linkedContainerIds={model.linkedContainerIds}
        mergeDocumentSummary={model.mergeDocumentSummary}
        nodes={model.explorer.nodes}
        openInlineDocument={model.openInlineDocument}
        openLinkDocumentModal={model.modalState.openLinkDocumentModal}
        openMoveDocumentModal={model.modalState.openMoveDocumentModal}
        ready={model.explorer.ready}
        refreshError={model.refreshError}
        selectedNode={model.selection.selectedNode}
        selectedDocument={model.selection.selectedDocument}
        setSelectedId={model.selection.setSelectedId}
        unlinkDocument={model.unlinkDocument}
      />
      <ExplorerContextMenuLayer
        canDeleteContextMenuNode={
          model.contextMenuState.canDeleteContextMenuNode
        }
        canMoveContextMenuNode={model.contextMenuState.canMoveContextMenuNode}
        closeContextMenu={model.contextMenuState.closeContextMenu}
        contextMenu={model.contextMenuState.contextMenu}
        contextMenuNode={model.contextMenuState.contextMenuNode}
        openCreateChildModal={model.modalState.openCreateChildModal}
        openDeleteModal={model.modalState.openDeleteModal}
        openInlineDocument={model.openInlineDocument}
        openMoveModal={model.modalState.openMoveModal}
        openRenameModal={model.modalState.openRenameModal}
        openSharePeerModal={model.modalState.openSharePeerModal}
        peerUserId={model.peerUserId}
      />
      <ExplorerModalLayer
        closeModal={model.modalState.closeModal}
        draftName={model.modalState.draftName}
        draftTargetContainerId={model.modalState.draftTargetContainerId}
        handleModalSubmit={model.modalState.handleModalSubmit}
        isSubmittingModal={model.modalState.isSubmittingModal}
        modalError={model.modalState.modalError}
        modalState={model.modalState.modalState}
        moveTargetOptions={model.modalState.moveTargetOptions}
        nameInputRef={model.modalState.nameInputRef}
        peerUserId={model.peerUserId}
        setDraftName={model.modalState.setDraftName}
        setModalError={model.modalState.setModalError}
        setDraftTargetContainerId={model.modalState.setDraftTargetContainerId}
        targetSelectRef={model.modalState.targetSelectRef}
      />
    </div>
  );
}
