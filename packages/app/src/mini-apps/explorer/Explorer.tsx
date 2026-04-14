import type { ContainerDocumentSummary } from "@tearleads/validators/response";
import {
  type FormEvent,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePeerUserId } from "../../components/pane/DualPaneProvider";
import { Menu, type MenuPosition } from "../../components/shared/Menu";
import { MenuItem } from "../../components/shared/MenuItem";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useAppData } from "../../data/AppDataProvider";
import { sqlDocumentContainerProjectionPersistence } from "../../data/documentContainerProjectionPersistence";
import {
  primeDocumentStore,
  subscribeToPersistedDocuments,
} from "../../data/documents/DocumentsProvider";
import {
  getStoredDocumentTypeLabel,
  getUntitledDocumentTitle,
  type StoredDocumentKind,
} from "../../data/documents/documentKinds";
import {
  type DocumentSummary,
  sqlDocumentsPersistence,
  upsertDiscoveredDocuments,
} from "../../data/documents/documentsPersistence";
import { DriverLicenseApp } from "../../document-types/drivers-license/DriverLicenseApp";
import { NotesApp } from "../notes/NotesApp";
import {
  discoverAllContainerDocuments,
  discoverContainerDocuments,
  hasUndiscoveredDocumentUpdateEvent,
} from "./documentDiscovery";
import { useExplorer } from "./ExplorerProvider";
import type { ContainerNode } from "./types";
import "./Explorer.css";

interface ExplorerTreeEntry {
  children: ExplorerTreeEntry[];
  node: ContainerNode;
}

type ExplorerModalState =
  | { mode: "create-child"; nodeId: string }
  | { mode: "delete"; nodeId: string }
  | { mode: "link-document"; documentLocalId: string }
  | { mode: "move"; nodeId: string }
  | { mode: "move-document"; documentLocalId: string }
  | { mode: "rename"; nodeId: string }
  | { mode: "share-peer"; nodeId: string };

interface MoveTargetOption {
  id: string;
  label: string;
}

interface DocumentContainerProjection {
  containerId: string;
  localId: string;
  title: string;
  updatedAt: string;
}

function getDocumentSummaryKind(
  documentSummary: Pick<DocumentSummary, "documentKind">,
): StoredDocumentKind {
  return documentSummary.documentKind ?? "note";
}

function isDestroyedDatabaseWorkerError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Database worker client has been destroyed."
  );
}

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

function getMoveTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  movingNodeId: string,
): ReadonlyArray<MoveTargetOption> {
  const movingNode = nodes.find((node) => node.id === movingNodeId);
  if (!movingNode || movingNode.parentId === null) {
    return [];
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const options = nodes
    .filter((candidateNode) => {
      if (
        candidateNode.id === movingNode.id ||
        candidateNode.organizationId !== movingNode.organizationId
      ) {
        return false;
      }

      let currentNode: ContainerNode | undefined = candidateNode;
      while (currentNode) {
        if (currentNode.parentId === movingNode.id) {
          return false;
        }

        currentNode = currentNode.parentId
          ? nodesById.get(currentNode.parentId)
          : undefined;
      }

      return true;
    })
    .map((candidateNode) => ({
      id: candidateNode.id,
      label: `${candidateNode.name} (${candidateNode.id})`,
    }));

  options.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    }),
  );

  return options;
}

function getDocumentMoveTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
  noteId: string,
): ReadonlyArray<MoveTargetOption> {
  const movingNote = documentSummaries.find((note) => note.id === noteId);
  if (!movingNote?.containerId) {
    return [];
  }

  const currentContainer = nodes.find(
    (node) => node.id === movingNote.containerId,
  );
  if (!currentContainer) {
    return [];
  }

  const options = nodes
    .filter(
      (candidateNode) =>
        candidateNode.id !== currentContainer.id &&
        candidateNode.organizationId === currentContainer.organizationId,
    )
    .map((candidateNode) => ({
      id: candidateNode.id,
      label: `${candidateNode.name} (${candidateNode.id})`,
    }));

  options.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    }),
  );

  return options;
}

function getDocumentLinkTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
  noteId: string,
  linkedContainerIds: ReadonlyArray<string>,
): ReadonlyArray<MoveTargetOption> {
  const linkingNote = documentSummaries.find((note) => note.id === noteId);
  if (!linkingNote?.containerId) {
    return [];
  }

  const currentContainer = nodes.find(
    (node) => node.id === linkingNote.containerId,
  );
  if (!currentContainer) {
    return [];
  }

  const linkedContainerIdSet = new Set(linkedContainerIds);
  const options = nodes
    .filter(
      (candidateNode) =>
        candidateNode.organizationId === currentContainer.organizationId &&
        !linkedContainerIdSet.has(candidateNode.id),
    )
    .map((candidateNode) => ({
      id: candidateNode.id,
      label: `${candidateNode.name} (${candidateNode.id})`,
    }));

  options.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    }),
  );

  return options;
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

function createDocumentsRuntimeFromExplorer(
  apiClient: ReturnType<typeof useAppData>["apiClient"],
  blobStore: ReturnType<typeof useAppData>["blobStore"],
  cacheReferencedPrincipalPolicies: ReturnType<
    typeof useAppData
  >["cacheReferencedPrincipalPolicies"],
  containerId: string,
  dbStatus: ReturnType<typeof useAppData>["dbStatus"],
  domainScope: ReturnType<typeof useAppData>["domainScope"],
  encapsulationKeyPair: ReturnType<typeof useAppData>["encapsulationKeyPair"],
  execSql: ReturnType<typeof useAppData>["execSql"],
  isAuthenticated: ReturnType<typeof useAppData>["isAuthenticated"],
  log: ReturnType<typeof useAppData>["log"],
  online: ReturnType<typeof useAppData>["online"],
) {
  return {
    apiClient: {
      commitDocumentChange: apiClient.commitDocumentChange.bind(apiClient),
      createDocument: apiClient.createDocument.bind(apiClient),
      getBlob: apiClient.getBlob.bind(apiClient),
      listDocumentAttachments:
        apiClient.listDocumentAttachments.bind(apiClient),
      stageBlob: apiClient.stageBlob.bind(apiClient),
      syncDocument: apiClient.syncDocument.bind(apiClient),
    },
    blobStore,
    cacheReferencedPrincipalPolicies,
    containerId,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    events: [],
    execSql,
    isAuthenticated,
    log,
    online,
  };
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
    createDocumentsRuntimeFromExplorer(
      appData.apiClient,
      appData.blobStore,
      appData.cacheReferencedPrincipalPolicies,
      note.containerId,
      appData.dbStatus,
      appData.domainScope,
      appData.encapsulationKeyPair,
      appData.execSql,
      appData.isAuthenticated,
      appData.log,
      appData.online,
    ),
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

function useDiscoveredDocumentsSync(params: {
  activeContainerId: string | null;
  apiClient: ReturnType<typeof useAppData>["apiClient"];
  blobStore: ReturnType<typeof useAppData>["blobStore"];
  cacheReferencedPrincipalPolicies: ReturnType<
    typeof useAppData
  >["cacheReferencedPrincipalPolicies"];
  dbStatus: ReturnType<typeof useAppData>["dbStatus"];
  domainScope: ReturnType<typeof useAppData>["domainScope"];
  encapsulationKeyPair: ReturnType<typeof useAppData>["encapsulationKeyPair"];
  events: ReturnType<typeof useAppData>["events"];
  execSql: ReturnType<typeof useAppData>["execSql"];
  isAuthenticated: ReturnType<typeof useAppData>["isAuthenticated"];
  knownDocumentIds: ReadonlySet<string>;
  log: ReturnType<typeof useAppData>["log"];
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  online: ReturnType<typeof useAppData>["online"];
  replaceDocumentLinksBatch: (
    inputs: ReadonlyArray<{
      containerIds: ReadonlyArray<string>;
      documentId: string;
    }>,
  ) => Promise<void>;
}) {
  const {
    activeContainerId,
    apiClient,
    blobStore,
    cacheReferencedPrincipalPolicies,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    events,
    execSql,
    isAuthenticated,
    knownDocumentIds,
    log,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    online,
    replaceDocumentLinksBatch,
  } = params;
  const { primeDiscoveredDocuments } = usePrimeDiscoveredDocuments({
    apiClient,
    blobStore,
    cacheReferencedPrincipalPolicies,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    execSql,
    isAuthenticated,
    log,
    mergeDocumentSummary,
    online,
  });

  const discoverDocumentsForContainer = useCallback(
    (containerId: string) => {
      let cancelled = false;

      void (async () => {
        try {
          const discoveredDocumentSummaries = await discoverContainerDocuments({
            cacheReferencedPrincipalPolicies,
            containerId,
            listContainerDocuments: (nextContainerId) =>
              apiClient.listContainerDocuments(nextContainerId),
            replaceDocumentLinksBatch,
            upsertDiscoveredDocuments: (inputs) =>
              upsertDiscoveredDocuments(execSql, inputs),
          });

          if (!discoveredDocumentSummaries || cancelled) {
            return;
          }

          mergeDocumentSummaries(discoveredDocumentSummaries);
          primeDiscoveredDocuments(discoveredDocumentSummaries);
        } catch (error: unknown) {
          if (!isDestroyedDatabaseWorkerError(error)) {
            throw error;
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    },
    [
      apiClient,
      cacheReferencedPrincipalPolicies,
      execSql,
      mergeDocumentSummaries,
      primeDiscoveredDocuments,
      replaceDocumentLinksBatch,
    ],
  );

  useContainerDiscoveryEffects({
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
    isAuthenticated,
    knownDocumentIds,
    online,
  });

  return { primeDiscoveredDocuments };
}

function useContainerDiscoveryEffects(params: {
  activeContainerId: string | null;
  dbStatus: ReturnType<typeof useAppData>["dbStatus"];
  discoverDocumentsForContainer: (
    containerId: string,
  ) => (() => void) | undefined;
  events: ReturnType<typeof useAppData>["events"];
  isAuthenticated: ReturnType<typeof useAppData>["isAuthenticated"];
  knownDocumentIds: ReadonlySet<string>;
  online: ReturnType<typeof useAppData>["online"];
}) {
  const {
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
    isAuthenticated,
    knownDocumentIds,
    online,
  } = params;

  useEffect(() => {
    if (
      !activeContainerId ||
      dbStatus !== "ready" ||
      !online ||
      !isAuthenticated
    ) {
      return;
    }

    return discoverDocumentsForContainer(activeContainerId);
  }, [
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    isAuthenticated,
    online,
  ]);

  useEffect(() => {
    if (
      !activeContainerId ||
      dbStatus !== "ready" ||
      !online ||
      !isAuthenticated ||
      !hasUndiscoveredDocumentUpdateEvent(events, knownDocumentIds)
    ) {
      return;
    }

    return discoverDocumentsForContainer(activeContainerId);
  }, [
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
    isAuthenticated,
    knownDocumentIds,
    online,
  ]);
}

function usePrimeDiscoveredDocuments(params: {
  apiClient: ReturnType<typeof useAppData>["apiClient"];
  blobStore: ReturnType<typeof useAppData>["blobStore"];
  cacheReferencedPrincipalPolicies: ReturnType<
    typeof useAppData
  >["cacheReferencedPrincipalPolicies"];
  dbStatus: ReturnType<typeof useAppData>["dbStatus"];
  domainScope: ReturnType<typeof useAppData>["domainScope"];
  encapsulationKeyPair: ReturnType<typeof useAppData>["encapsulationKeyPair"];
  execSql: ReturnType<typeof useAppData>["execSql"];
  isAuthenticated: ReturnType<typeof useAppData>["isAuthenticated"];
  log: ReturnType<typeof useAppData>["log"];
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  online: ReturnType<typeof useAppData>["online"];
}) {
  const {
    apiClient,
    blobStore,
    cacheReferencedPrincipalPolicies,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    execSql,
    isAuthenticated,
    log,
    mergeDocumentSummary,
    online,
  } = params;

  const primeDiscoveredDocuments = useCallback(
    (discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>) => {
      for (const documentSummary of discoveredDocumentSummaries) {
        if (!documentSummary.containerId) {
          continue;
        }

        const documentStore = primeDocumentStore(
          domainScope,
          documentSummary.id,
          createDocumentsRuntimeFromExplorer(
            apiClient,
            blobStore,
            cacheReferencedPrincipalPolicies,
            documentSummary.containerId,
            dbStatus,
            domainScope,
            encapsulationKeyPair,
            execSql,
            isAuthenticated,
            log,
            online,
          ),
          mergeDocumentSummary,
          documentSummary.documentId,
        );
        documentStore.requestSync();
      }
    },
    [
      apiClient,
      blobStore,
      cacheReferencedPrincipalPolicies,
      dbStatus,
      domainScope,
      encapsulationKeyPair,
      execSql,
      isAuthenticated,
      log,
      mergeDocumentSummary,
      online,
    ],
  );

  return { primeDiscoveredDocuments };
}

function useExplorerRefreshAction(params: {
  apiClient: ReturnType<typeof useAppData>["apiClient"];
  cacheReferencedPrincipalPolicies: ReturnType<
    typeof useAppData
  >["cacheReferencedPrincipalPolicies"];
  execSql: ReturnType<typeof useAppData>["execSql"];
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
    apiClient,
    cacheReferencedPrincipalPolicies,
    execSql,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
  } = params;
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

function getExplorerModalError(mode: ExplorerModalState["mode"]): string {
  switch (mode) {
    case "create-child":
      return "Failed to create child container.";
    case "rename":
      return "Failed to rename container.";
    case "delete":
      return "Failed to delete container.";
    case "link-document":
      return "Failed to link document.";
    case "move":
      return "Failed to move container.";
    case "move-document":
      return "Failed to move document.";
    case "share-peer":
      return "Failed to share container with peer.";
  }
}

function getExplorerModalLog(mode: ExplorerModalState["mode"]): string {
  switch (mode) {
    case "create-child":
      return "Failed to create child container:";
    case "rename":
      return "Failed to rename container:";
    case "delete":
      return "Failed to delete container:";
    case "link-document":
      return "Failed to link document:";
    case "move":
      return "Failed to move container:";
    case "move-document":
      return "Failed to move document:";
    case "share-peer":
      return "Failed to share container with peer:";
  }
}

function clearExplorerModalState(
  setModalState: (state: ExplorerModalState | null) => void,
  setModalError: (error: string | null) => void,
  setDraftName: (value: string) => void,
  setDraftTargetContainerId: (value: string) => void,
) {
  setModalState(null);
  setModalError(null);
  setDraftName("");
  setDraftTargetContainerId("");
}

async function submitExplorerDeleteModal(params: {
  deleteContainer: (containerId: string) => Promise<boolean>;
  modalState: { mode: "delete"; nodeId: string };
  nodes: ReadonlyArray<ContainerNode>;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  clearModal: () => void;
}) {
  const {
    clearModal,
    deleteContainer,
    modalState,
    nodes,
    setModalError,
    setSelectedId,
  } = params;
  const deletingNode = nodes.find((node) => node.id === modalState.nodeId);
  const deleted = await deleteContainer(modalState.nodeId);
  if (!deleted) {
    setModalError("Failed to delete container.");
    return;
  }

  setSelectedId(deletingNode?.parentId ?? null);
  clearModal();
}

async function submitExplorerMoveModal(params: {
  modalState: { mode: "move"; nodeId: string };
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  targetContainerId: string;
  clearModal: () => void;
}) {
  const {
    clearModal,
    modalState,
    moveContainer,
    setModalError,
    setSelectedId,
    targetContainerId,
  } = params;

  if (!targetContainerId) {
    setModalError("Choose a destination container.");
    return;
  }

  const movedNode = await moveContainer(modalState.nodeId, targetContainerId);
  if (!movedNode) {
    setModalError("Failed to move container.");
    return;
  }

  setSelectedId(movedNode.id);
  clearModal();
}

async function submitExplorerShareModal(params: {
  modalState: { mode: "share-peer"; nodeId: string };
  peerUserId: string | null;
  setModalError: (error: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  clearModal: () => void;
}) {
  const { clearModal, modalState, peerUserId, setModalError, shareWithUser } =
    params;
  if (!peerUserId) {
    setModalError("No peer user is available.");
    return;
  }

  const shared = await shareWithUser(modalState.nodeId, peerUserId);
  if (!shared) {
    setModalError("Failed to share container with peer.");
    return;
  }

  clearModal();
}

async function submitExplorerNameModal(params: {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  draftName: string;
  expandNode: (nodeId: string) => void;
  modalState:
    | { mode: "create-child"; nodeId: string }
    | { mode: "rename"; nodeId: string };
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  clearModal: () => void;
}) {
  const {
    clearModal,
    createChild,
    draftName,
    expandNode,
    modalState,
    renameContainer,
    setModalError,
    setSelectedId,
  } = params;
  const nextNode =
    modalState.mode === "create-child"
      ? await createChild(modalState.nodeId, draftName)
      : await renameContainer(modalState.nodeId, draftName);
  if (!nextNode) {
    setModalError(getExplorerModalError(modalState.mode));
    return;
  }

  setSelectedId(nextNode.id);
  if (modalState.mode === "create-child") {
    expandNode(modalState.nodeId);
  }
  clearModal();
}

function useExplorerModalEffects(params: {
  closeModal: () => void;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState | null;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { closeModal, isSubmittingModal, modalState, nameInputRef } = params;

  useEffect(() => {
    if (
      !modalState ||
      modalState.mode === "delete" ||
      modalState.mode === "link-document" ||
      modalState.mode === "move" ||
      modalState.mode === "move-document" ||
      modalState.mode === "share-peer"
    ) {
      return;
    }

    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [modalState, nameInputRef]);

  useEffect(() => {
    if (!modalState) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmittingModal) {
        event.preventDefault();
        closeModal();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeModal, isSubmittingModal, modalState]);
}

function useExplorerTargetModalOpeners(params: {
  nodes: ReadonlyArray<ContainerNode>;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
}) {
  const {
    nodes,
    documentSummaries,
    selectedDocumentLinkedContainerIds,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
  } = params;

  const openMoveModal = useCallback(
    (containerId: string) => {
      const moveTargetOptions = getMoveTargetOptions(nodes, containerId);
      if (moveTargetOptions.length === 0) {
        return;
      }

      setModalState({ mode: "move", nodeId: containerId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId(moveTargetOptions[0]?.id ?? "");
    },
    [
      nodes,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  const openMoveDocumentModal = useCallback(
    (documentLocalId: string) => {
      const moveTargetOptions = getDocumentMoveTargetOptions(
        nodes,
        documentSummaries,
        documentLocalId,
      );
      if (moveTargetOptions.length === 0) {
        return;
      }

      setModalState({ mode: "move-document", documentLocalId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId(moveTargetOptions[0]?.id ?? "");
    },
    [
      nodes,
      documentSummaries,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  const openLinkDocumentModal = useCallback(
    (documentLocalId: string) => {
      const linkTargetOptions = getDocumentLinkTargetOptions(
        nodes,
        documentSummaries,
        documentLocalId,
        selectedDocumentLinkedContainerIds,
      );
      if (linkTargetOptions.length === 0) {
        return;
      }

      setModalState({ mode: "link-document", documentLocalId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId(linkTargetOptions[0]?.id ?? "");
    },
    [
      nodes,
      documentSummaries,
      selectedDocumentLinkedContainerIds,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  return {
    openLinkDocumentModal,
    openMoveModal,
    openMoveDocumentModal,
  };
}

function useExplorerModalOpeners(params: {
  nodes: ReadonlyArray<ContainerNode>;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
}) {
  const {
    nodes,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
  } = params;
  const targetOpeners = useExplorerTargetModalOpeners(params);

  const openCreateChildModal = useCallback(
    (parentId: string) => {
      setModalState({ mode: "create-child", nodeId: parentId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [setDraftName, setDraftTargetContainerId, setModalError, setModalState],
  );

  const openRenameModal = useCallback(
    (containerId: string) => {
      const container = nodes.find((node) => node.id === containerId);
      if (!container) {
        return;
      }

      setModalState({ mode: "rename", nodeId: containerId });
      setModalError(null);
      setDraftName(container.name);
      setDraftTargetContainerId("");
    },
    [
      nodes,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  const openDeleteModal = useCallback(
    (containerId: string) => {
      setModalState({ mode: "delete", nodeId: containerId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [setDraftName, setDraftTargetContainerId, setModalError, setModalState],
  );

  const openSharePeerModal = useCallback(
    (containerId: string) => {
      setModalState({ mode: "share-peer", nodeId: containerId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [setDraftName, setDraftTargetContainerId, setModalError, setModalState],
  );

  return {
    openCreateChildModal,
    openDeleteModal,
    openRenameModal,
    openSharePeerModal,
    ...targetOpeners,
  };
}

function useExplorerModalState(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>,
) {
  const [modalState, setModalState] = useState<ExplorerModalState | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftTargetContainerId, setDraftTargetContainerId] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const clearModal = useCallback(
    () =>
      clearExplorerModalState(
        setModalState,
        setModalError,
        setDraftName,
        setDraftTargetContainerId,
      ),
    [],
  );

  const closeModal = useCallback(() => {
    if (!isSubmittingModal) {
      clearModal();
    }
  }, [clearModal, isSubmittingModal]);
  const openers = useExplorerModalOpeners({
    nodes,
    documentSummaries,
    selectedDocumentLinkedContainerIds,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
  });
  useExplorerModalEffects({
    closeModal,
    isSubmittingModal,
    modalState,
    nameInputRef,
  });

  return {
    clearModal,
    closeModal,
    draftName,
    draftTargetContainerId,
    isSubmittingModal,
    modalError,
    modalState,
    nameInputRef,
    ...openers,
    setDraftName,
    setIsSubmittingModal,
    setModalError,
    setDraftTargetContainerId,
  };
}

interface ExplorerModalSubmitParams {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  clearModal: () => void;
  deleteContainer: (containerId: string) => Promise<boolean>;
  draftName: string;
  draftTargetContainerId: string;
  expandNode: (nodeId: string) => void;
  isSubmittingModal: boolean;
  linkDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  modalState: ExplorerModalState | null;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  moveDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  nodes: ReadonlyArray<ContainerNode>;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  peerUserId: string | null;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  setIsSubmittingModal: (value: boolean) => void;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}

async function submitExplorerMoveDocumentModal(params: {
  clearModal: () => void;
  linkDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  modalState:
    | { mode: "link-document"; documentLocalId: string }
    | { mode: "move-document"; documentLocalId: string };
  moveDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  targetContainerId: string;
}) {
  const {
    clearModal,
    linkDocument,
    modalState,
    moveDocument,
    setModalError,
    setSelectedId,
    targetContainerId,
  } = params;

  if (!targetContainerId) {
    setModalError("Choose a destination container.");
    return;
  }

  const movedDocument =
    modalState.mode === "link-document"
      ? await linkDocument(modalState.documentLocalId, targetContainerId)
      : await moveDocument(modalState.documentLocalId, targetContainerId);
  if (!movedDocument) {
    setModalError(
      modalState.mode === "link-document"
        ? "Failed to link document."
        : "Failed to move document.",
    );
    return;
  }

  setSelectedId(movedDocument.id);
  clearModal();
}

async function submitExplorerNonNameModal(params: {
  clearModal: () => void;
  deleteContainer: (containerId: string) => Promise<boolean>;
  draftTargetContainerId: string;
  modalState:
    | { mode: "delete"; nodeId: string }
    | { mode: "link-document"; documentLocalId: string }
    | { mode: "move"; nodeId: string }
    | { mode: "move-document"; documentLocalId: string }
    | { mode: "share-peer"; nodeId: string };
  linkDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  moveDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  nodes: ReadonlyArray<ContainerNode>;
  peerUserId: string | null;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const { modalState } = params;

  switch (modalState.mode) {
    case "delete":
      await submitExplorerDeleteModal({
        clearModal: params.clearModal,
        deleteContainer: params.deleteContainer,
        modalState,
        nodes: params.nodes,
        setModalError: params.setModalError,
        setSelectedId: params.setSelectedId,
      });
      return;
    case "move":
      await submitExplorerMoveModal({
        clearModal: params.clearModal,
        modalState,
        moveContainer: params.moveContainer,
        setModalError: params.setModalError,
        setSelectedId: params.setSelectedId,
        targetContainerId: params.draftTargetContainerId,
      });
      return;
    case "link-document":
    case "move-document":
      await submitExplorerMoveDocumentModal({
        clearModal: params.clearModal,
        linkDocument: params.linkDocument,
        modalState,
        moveDocument: params.moveDocument,
        setModalError: params.setModalError,
        setSelectedId: params.setSelectedId,
        targetContainerId: params.draftTargetContainerId,
      });
      return;
    case "share-peer":
      await submitExplorerShareModal({
        clearModal: params.clearModal,
        modalState,
        peerUserId: params.peerUserId,
        setModalError: params.setModalError,
        shareWithUser: params.shareWithUser,
      });
      return;
  }
}

function useExplorerModalAction(params: ExplorerModalSubmitParams) {
  const {
    clearModal,
    createChild,
    deleteContainer,
    draftName,
    draftTargetContainerId,
    expandNode,
    linkDocument,
    modalState,
    moveContainer,
    moveDocument,
    nodes,
    peerUserId,
    renameContainer,
    setModalError,
    setSelectedId,
    shareWithUser,
  } = params;

  return useCallback(async () => {
    if (!modalState) {
      return;
    }

    if (modalState.mode === "create-child" || modalState.mode === "rename") {
      await submitExplorerNameModal({
        clearModal,
        createChild,
        draftName,
        expandNode,
        modalState,
        renameContainer,
        setModalError,
        setSelectedId,
      });
      return;
    }

    await submitExplorerNonNameModal({
      clearModal,
      deleteContainer,
      draftTargetContainerId,
      linkDocument,
      modalState,
      moveContainer,
      moveDocument,
      nodes,
      peerUserId,
      setModalError,
      setSelectedId,
      shareWithUser,
    });
  }, [
    clearModal,
    createChild,
    deleteContainer,
    draftName,
    draftTargetContainerId,
    expandNode,
    linkDocument,
    modalState,
    moveContainer,
    moveDocument,
    nodes,
    peerUserId,
    renameContainer,
    setModalError,
    setSelectedId,
    shareWithUser,
  ]);
}

function useExplorerModalSubmit(params: ExplorerModalSubmitParams) {
  const { isSubmittingModal, modalState, setIsSubmittingModal, setModalError } =
    params;
  const submitModal = useExplorerModalAction(params);

  return useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!modalState || isSubmittingModal) {
        return;
      }

      setModalError(null);
      setIsSubmittingModal(true);

      try {
        await submitModal();
      } catch (error: unknown) {
        console.error(getExplorerModalLog(modalState.mode), error);
        setModalError(getExplorerModalError(modalState.mode));
      } finally {
        setIsSubmittingModal(false);
      }
    },
    [
      isSubmittingModal,
      modalState,
      submitModal,
      setIsSubmittingModal,
      setModalError,
    ],
  );
}

function useExplorerModalController(params: {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  expandNode: (nodeId: string) => void;
  linkDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  moveDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  nodes: ReadonlyArray<ContainerNode>;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  peerUserId: string | null;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  setSelectedId: (id: string | null) => void;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const modalState = useExplorerModalState(
    params.nodes,
    params.documentSummaries,
    params.selectedDocumentLinkedContainerIds,
  );
  const moveTargetOptions =
    modalState.modalState?.mode === "move"
      ? getMoveTargetOptions(params.nodes, modalState.modalState.nodeId)
      : modalState.modalState?.mode === "link-document"
        ? getDocumentLinkTargetOptions(
            params.nodes,
            params.documentSummaries,
            modalState.modalState.documentLocalId,
            params.selectedDocumentLinkedContainerIds,
          )
        : modalState.modalState?.mode === "move-document"
          ? getDocumentMoveTargetOptions(
              params.nodes,
              params.documentSummaries,
              modalState.modalState.documentLocalId,
            )
          : [];
  const handleModalSubmit = useExplorerModalSubmit({
    ...params,
    clearModal: modalState.clearModal,
    draftName: modalState.draftName,
    draftTargetContainerId: modalState.draftTargetContainerId,
    isSubmittingModal: modalState.isSubmittingModal,
    modalState: modalState.modalState,
    setIsSubmittingModal: modalState.setIsSubmittingModal,
    setModalError: modalState.setModalError,
  });

  return {
    closeModal: modalState.closeModal,
    draftName: modalState.draftName,
    draftTargetContainerId: modalState.draftTargetContainerId,
    handleModalSubmit,
    isSubmittingModal: modalState.isSubmittingModal,
    modalError: modalState.modalError,
    modalState: modalState.modalState,
    moveTargetOptions,
    nameInputRef: modalState.nameInputRef,
    openCreateChildModal: modalState.openCreateChildModal,
    openDeleteModal: modalState.openDeleteModal,
    openLinkDocumentModal: modalState.openLinkDocumentModal,
    openMoveModal: modalState.openMoveModal,
    openMoveDocumentModal: modalState.openMoveDocumentModal,
    openRenameModal: modalState.openRenameModal,
    openSharePeerModal: modalState.openSharePeerModal,
    setDraftName: modalState.setDraftName,
    setModalError: modalState.setModalError,
    setDraftTargetContainerId: modalState.setDraftTargetContainerId,
  };
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

function useExplorerContextMenu(
  nodes: ReadonlyArray<ContainerNode>,
  setSelectedId: (id: string | null) => void,
) {
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    position: MenuPosition;
  } | null>(null);

  const handleSidebarContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, nodeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedId(nodeId);
      setContextMenu({
        nodeId,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [setSelectedId],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const contextMenuNode = nodes.find((node) => node.id === contextMenu?.nodeId);
  const contextMenuNodeHasChildren =
    contextMenuNode !== undefined &&
    nodes.some((node) => node.parentId === contextMenuNode.id);
  const contextMenuNodeMoveTargets =
    contextMenuNode === undefined
      ? []
      : getMoveTargetOptions(nodes, contextMenuNode.id);

  return {
    canDeleteContextMenuNode:
      contextMenuNode !== undefined &&
      contextMenuNode.parentId !== null &&
      !contextMenuNodeHasChildren,
    canMoveContextMenuNode: contextMenuNodeMoveTargets.length > 0,
    closeContextMenu,
    contextMenu,
    contextMenuNode,
    handleSidebarContextMenu,
  };
}

function useInlineDocumentAction(params: {
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const { expandNode, mergeDocumentSummary, setSelectedId } = params;

  return useCallback(
    (
      containerId: string,
      documentKind: StoredDocumentKind,
      noteId?: string,
    ) => {
      const nextNoteId = noteId ?? crypto.randomUUID();

      if (!noteId) {
        mergeDocumentSummary({
          id: nextNoteId,
          containerId,
          documentKind,
          documentId: null,
          title: getUntitledDocumentTitle(documentKind),
          updatedAt: new Date().toISOString(),
        });
      }

      setSelectedId(nextNoteId);
      expandNode(containerId);
    },
    [expandNode, mergeDocumentSummary, setSelectedId],
  );
}

function useInlineDocumentOpeners(params: {
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const openInlineDocument = useInlineDocumentAction(params);

  return {
    openInlineDriverLicense: useCallback(
      (containerId: string, noteId?: string) =>
        openInlineDocument(containerId, "drivers_license", noteId),
      [openInlineDocument],
    ),
    openInlineNote: useCallback(
      (containerId: string, noteId?: string) =>
        openInlineDocument(containerId, "note", noteId),
      [openInlineDocument],
    ),
  };
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
    createDocumentsRuntimeFromExplorer(
      appData.apiClient,
      appData.blobStore,
      appData.cacheReferencedPrincipalPolicies,
      targetContainerId,
      appData.dbStatus,
      appData.domainScope,
      appData.encapsulationKeyPair,
      appData.execSql,
      appData.isAuthenticated,
      appData.log,
      appData.online,
    ),
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

interface LinkedContainerDetail {
  id: string;
  isActive: boolean;
  label: string;
}

function getLinkedContainerDetails(
  nodes: ReadonlyArray<ContainerNode>,
  linkedContainerIds: ReadonlyArray<string>,
  activeContainerId: string | null,
): ReadonlyArray<LinkedContainerDetail> {
  return linkedContainerIds.map((linkedContainerId) => {
    const linkedContainer = nodes.find((node) => node.id === linkedContainerId);

    return {
      id: linkedContainerId,
      isActive: linkedContainerId === activeContainerId,
      label: linkedContainer?.name ?? linkedContainerId,
    };
  });
}

function ExplorerDocumentDetailActions(params: {
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  openLinkDocumentModal: (noteId: string) => void;
  openMoveDocumentModal: (noteId: string) => void;
  ready: boolean;
  selectedDocument: DocumentSummary;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    canLinkSelectedDocument,
    canMoveSelectedDocument,
    handleRefresh,
    isRefreshing,
    openLinkDocumentModal,
    openMoveDocumentModal,
    ready,
    selectedDocument,
    setSelectedId,
  } = params;

  return (
    <div className="explorer-detail-actions">
      <button
        type="button"
        className="explorer-action-button"
        onClick={() => {
          if (selectedDocument.containerId) {
            setSelectedId(selectedDocument.containerId);
          }
        }}
      >
        Back to Container
      </button>
      <button
        type="button"
        className="explorer-action-button"
        disabled={!canLinkSelectedDocument}
        onClick={() => {
          openLinkDocumentModal(selectedDocument.id);
        }}
      >
        Link
      </button>
      <button
        type="button"
        className="explorer-action-button"
        disabled={!canMoveSelectedDocument}
        onClick={() => {
          openMoveDocumentModal(selectedDocument.id);
        }}
      >
        Move
      </button>
      <button
        type="button"
        className="explorer-action-button"
        disabled={!ready || isRefreshing}
        onClick={() => {
          void handleRefresh();
        }}
      >
        {isRefreshing ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  );
}

function ExplorerLinkedContainerSection(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocument: DocumentSummary;
  setSelectedId: (id: string | null) => void;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const {
    activateLinkedContainer,
    canActivateSelectedDocument,
    canUnlinkSelectedDocument,
    linkedContainerIds,
    nodes,
    selectedDocument,
    setSelectedId,
    unlinkDocument,
  } = params;
  const [activatingContainerId, setActivatingContainerId] = useState<
    string | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unlinkingContainerId, setUnlinkingContainerId] = useState<
    string | null
  >(null);
  const linkedContainers = getLinkedContainerDetails(
    nodes,
    linkedContainerIds,
    selectedDocument.containerId,
  );

  return (
    <div className="explorer-linked-container-section">
      <strong>Linked Containers</strong>
      <ul className="explorer-linked-container-list">
        {linkedContainers.map((linkedContainer) => (
          <ExplorerLinkedContainerRow
            activateLinkedContainer={activateLinkedContainer}
            activatingContainerId={activatingContainerId}
            canActivateSelectedDocument={canActivateSelectedDocument}
            canUnlinkSelectedDocument={canUnlinkSelectedDocument}
            key={linkedContainer.id}
            linkedContainer={linkedContainer}
            selectedDocumentId={selectedDocument.id}
            setActionError={setActionError}
            setActivatingContainerId={setActivatingContainerId}
            setSelectedId={setSelectedId}
            setUnlinkingContainerId={setUnlinkingContainerId}
            unlinkingContainerId={unlinkingContainerId}
            unlinkDocument={unlinkDocument}
          />
        ))}
      </ul>
      {actionError ? (
        <span className="explorer-detail-error">{actionError}</span>
      ) : null}
    </div>
  );
}

function ExplorerLinkedContainerRow(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  activatingContainerId: string | null;
  canActivateSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  linkedContainer: LinkedContainerDetail;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setActivatingContainerId: (containerId: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setUnlinkingContainerId: (containerId: string | null) => void;
  unlinkingContainerId: string | null;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const {
    activateLinkedContainer,
    canActivateSelectedDocument,
    canUnlinkSelectedDocument,
    activatingContainerId,
    linkedContainer,
    selectedDocumentId,
    setActionError,
    setActivatingContainerId,
    setSelectedId,
    setUnlinkingContainerId,
    unlinkingContainerId,
    unlinkDocument,
  } = params;

  return (
    <li className="explorer-linked-container-row">
      <button
        type="button"
        className="explorer-linked-container-button"
        aria-label={`Open linked container ${linkedContainer.label}`}
        onClick={() => {
          setSelectedId(linkedContainer.id);
        }}
      >
        {linkedContainer.label}
      </button>
      <div className="explorer-linked-container-actions">
        {linkedContainer.isActive ? (
          <span className="explorer-linked-container-badge">Active</span>
        ) : (
          <button
            type="button"
            className="explorer-action-button"
            aria-label={`Make linked container ${linkedContainer.label} active`}
            disabled={
              !canActivateSelectedDocument ||
              activatingContainerId !== null ||
              unlinkingContainerId !== null
            }
            onClick={() => {
              if (
                activatingContainerId !== null ||
                unlinkingContainerId !== null
              ) {
                return;
              }

              void handleActivateLinkedContainer({
                activateLinkedContainer,
                linkedContainer,
                selectedDocumentId,
                setActionError,
                setActivatingContainerId,
              });
            }}
          >
            {activatingContainerId === linkedContainer.id
              ? "Activating..."
              : "Make Active"}
          </button>
        )}
        <button
          type="button"
          className="explorer-action-button"
          aria-label={`Detach linked container ${linkedContainer.label}`}
          disabled={
            !canUnlinkSelectedDocument ||
            activatingContainerId !== null ||
            unlinkingContainerId !== null
          }
          onClick={() => {
            if (
              activatingContainerId !== null ||
              unlinkingContainerId !== null
            ) {
              return;
            }

            void handleDetachLinkedContainer({
              linkedContainer,
              selectedDocumentId,
              setActionError,
              setUnlinkingContainerId,
              unlinkDocument,
            });
          }}
        >
          {unlinkingContainerId === linkedContainer.id
            ? "Detaching..."
            : "Detach"}
        </button>
      </div>
    </li>
  );
}

async function handleActivateLinkedContainer(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  linkedContainer: LinkedContainerDetail;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setActivatingContainerId: (containerId: string | null) => void;
}) {
  const {
    activateLinkedContainer,
    linkedContainer,
    selectedDocumentId,
    setActionError,
    setActivatingContainerId,
  } = params;

  setActionError(null);
  setActivatingContainerId(linkedContainer.id);
  try {
    const activatedNote = await activateLinkedContainer(
      selectedDocumentId,
      linkedContainer.id,
    );
    if (!activatedNote) {
      setActionError(`Failed to make ${linkedContainer.label} active.`);
    }
  } catch {
    setActionError(`Failed to make ${linkedContainer.label} active.`);
  } finally {
    setActivatingContainerId(null);
  }
}

async function handleDetachLinkedContainer(params: {
  linkedContainer: LinkedContainerDetail;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setUnlinkingContainerId: (containerId: string | null) => void;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const {
    linkedContainer,
    selectedDocumentId,
    setActionError,
    setUnlinkingContainerId,
    unlinkDocument,
  } = params;

  setActionError(null);
  setUnlinkingContainerId(linkedContainer.id);
  try {
    const unlinkedNote = await unlinkDocument(
      selectedDocumentId,
      linkedContainer.id,
    );
    if (!unlinkedNote) {
      setActionError(`Failed to detach ${linkedContainer.label}.`);
    }
  } catch {
    setActionError(`Failed to detach ${linkedContainer.label}.`);
  } finally {
    setUnlinkingContainerId(null);
  }
}

function ExplorerDocumentDetail(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  canMoveSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  openLinkDocumentModal: (noteId: string) => void;
  openMoveDocumentModal: (noteId: string) => void;
  ready: boolean;
  refreshError: string | null;
  selectedDocument: DocumentSummary;
  setSelectedId: (id: string | null) => void;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const selectedDocumentKind = getDocumentSummaryKind(params.selectedDocument);
  const selectedDocumentContainer = params.selectedDocument.containerId
    ? params.nodes.find(
        (node) => node.id === params.selectedDocument.containerId,
      )
    : null;

  return (
    <div
      className="explorer-detail explorer-detail--note"
      key={params.selectedDocument.id}
    >
      <div className="explorer-detail-header">
        <div className="explorer-detail-copy">
          <strong>{params.selectedDocument.title}</strong>
          <span>
            {getStoredDocumentTypeLabel(selectedDocumentKind)}
            {selectedDocumentContainer
              ? ` in ${selectedDocumentContainer.name}`
              : ""}
          </span>
        </div>
        <ExplorerDocumentDetailActions
          canLinkSelectedDocument={params.canLinkSelectedDocument}
          canMoveSelectedDocument={params.canMoveSelectedDocument}
          handleRefresh={params.handleRefresh}
          isRefreshing={params.isRefreshing}
          openLinkDocumentModal={params.openLinkDocumentModal}
          openMoveDocumentModal={params.openMoveDocumentModal}
          ready={params.ready}
          selectedDocument={params.selectedDocument}
          setSelectedId={params.setSelectedId}
        />
      </div>
      {params.refreshError ? (
        <span className="explorer-detail-error">{params.refreshError}</span>
      ) : null}
      <ExplorerLinkedContainerSection
        activateLinkedContainer={params.activateLinkedContainer}
        canActivateSelectedDocument={params.canActivateSelectedDocument}
        canUnlinkSelectedDocument={params.canUnlinkSelectedDocument}
        linkedContainerIds={params.linkedContainerIds}
        nodes={params.nodes}
        selectedDocument={params.selectedDocument}
        setSelectedId={params.setSelectedId}
        unlinkDocument={params.unlinkDocument}
      />
      <div className="explorer-inline-note">
        {selectedDocumentKind === "drivers_license" ? (
          <DriverLicenseApp
            noteId={params.selectedDocument.id}
            {...(params.selectedDocument.containerId === undefined
              ? {}
              : { containerId: params.selectedDocument.containerId })}
            {...(params.selectedDocument.documentId === undefined
              ? {}
              : { documentId: params.selectedDocument.documentId })}
            onPersistedNote={params.mergeDocumentSummary}
          />
        ) : (
          <NotesApp
            noteId={params.selectedDocument.id}
            {...(params.selectedDocument.containerId === undefined
              ? {}
              : { containerId: params.selectedDocument.containerId })}
            {...(params.selectedDocument.documentId === undefined
              ? {}
              : { documentId: params.selectedDocument.documentId })}
            onPersistedNote={params.mergeDocumentSummary}
          />
        )}
      </div>
    </div>
  );
}

function ExplorerContainerDetail(params: {
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  openInlineDriverLicense: (containerId: string, noteId?: string) => void;
  openInlineNote: (containerId: string, noteId?: string) => void;
  ready: boolean;
  refreshError: string | null;
  selectedNode: ContainerNode;
}) {
  const {
    handleRefresh,
    isRefreshing,
    openInlineDriverLicense,
    openInlineNote,
    ready,
    refreshError,
    selectedNode,
  } = params;

  return (
    <div className="explorer-detail" key={selectedNode.id}>
      <div className="explorer-detail-header">
        <div className="explorer-detail-copy">
          <strong>{selectedNode.name}</strong>
          <span>{selectedNode.kind}</span>
        </div>
        <div className="explorer-detail-actions">
          <button
            type="button"
            className="explorer-action-button"
            onClick={() => {
              openInlineNote(selectedNode.id);
            }}
          >
            New Note
          </button>
          <button
            type="button"
            className="explorer-action-button"
            onClick={() => {
              openInlineDriverLicense(selectedNode.id);
            }}
          >
            New Driver&apos;s License
          </button>
          <button
            type="button"
            className="explorer-action-button"
            disabled={!ready || isRefreshing}
            onClick={() => {
              void handleRefresh();
            }}
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      <span>ID: {selectedNode.id}</span>
      <span>Parent: {selectedNode.parentId ?? "(root)"}</span>
      <span>Organization: {selectedNode.organizationId || "(local)"}</span>
      {refreshError ? (
        <span className="explorer-detail-error">{refreshError}</span>
      ) : null}
    </div>
  );
}

function ExplorerEmptyDetail(params: {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}) {
  const { nodes, ready } = params;

  return (
    <div className="explorer-hint">
      {ready && nodes.length > 0
        ? "Select a container."
        : !ready
          ? "Loading..."
          : "No containers."}
    </div>
  );
}

function ExplorerDetailPanel(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  openInlineDriverLicense: (containerId: string, noteId?: string) => void;
  openInlineNote: (containerId: string, noteId?: string) => void;
  openLinkDocumentModal: (noteId: string) => void;
  openMoveDocumentModal: (noteId: string) => void;
  ready: boolean;
  refreshError: string | null;
  selectedNode: ContainerNode | undefined;
  selectedDocument: DocumentSummary | undefined;
  setSelectedId: (id: string | null) => void;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const { selectedNode, selectedDocument } = params;

  if (selectedDocument) {
    return (
      <ExplorerDocumentDetail {...params} selectedDocument={selectedDocument} />
    );
  }

  if (selectedNode) {
    return <ExplorerContainerDetail {...params} selectedNode={selectedNode} />;
  }

  return <ExplorerEmptyDetail nodes={params.nodes} ready={params.ready} />;
}

function ExplorerContextMenuLayer(params: {
  canDeleteContextMenuNode: boolean;
  canMoveContextMenuNode: boolean;
  closeContextMenu: () => void;
  contextMenu: { nodeId: string; position: MenuPosition } | null;
  contextMenuNode: ContainerNode | undefined;
  openCreateChildModal: (containerId: string) => void;
  openDeleteModal: (containerId: string) => void;
  openInlineDriverLicense: (containerId: string, noteId?: string) => void;
  openInlineNote: (containerId: string, noteId?: string) => void;
  openMoveModal: (containerId: string) => void;
  openRenameModal: (containerId: string) => void;
  openSharePeerModal: (containerId: string) => void;
  peerUserId: string | null;
}) {
  const {
    canDeleteContextMenuNode,
    canMoveContextMenuNode,
    closeContextMenu,
    contextMenu,
    contextMenuNode,
    openCreateChildModal,
    openDeleteModal,
    openInlineDriverLicense,
    openInlineNote,
    openMoveModal,
    openRenameModal,
    openSharePeerModal,
    peerUserId,
  } = params;

  if (!contextMenu) {
    return null;
  }

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      <MenuItem
        label="Create Child"
        onClick={() => {
          closeContextMenu();
          openCreateChildModal(contextMenu.nodeId);
        }}
      />
      <MenuItem
        label="New Note"
        onClick={() => {
          if (contextMenuNode) {
            openInlineNote(contextMenuNode.id);
          }
          closeContextMenu();
        }}
      />
      <MenuItem
        label="New Driver's License"
        onClick={() => {
          if (contextMenuNode) {
            openInlineDriverLicense(contextMenuNode.id);
          }
          closeContextMenu();
        }}
      />
      <MenuItem
        label="Rename"
        onClick={() => {
          closeContextMenu();
          openRenameModal(contextMenu.nodeId);
        }}
      />
      <MenuItem
        label="Move"
        disabled={!canMoveContextMenuNode}
        onClick={() => {
          closeContextMenu();
          openMoveModal(contextMenu.nodeId);
        }}
      />
      <MenuItem
        label="Share With Peer"
        disabled={!peerUserId}
        onClick={() => {
          closeContextMenu();
          openSharePeerModal(contextMenu.nodeId);
        }}
      />
      <MenuItem
        label="Delete"
        disabled={!canDeleteContextMenuNode}
        onClick={() => {
          closeContextMenu();
          openDeleteModal(contextMenu.nodeId);
        }}
      />
    </Menu>
  );
}

function getExplorerModalTitle(modalState: ExplorerModalState): string {
  switch (modalState.mode) {
    case "delete":
      return "Delete Container";
    case "link-document":
      return "Link Document";
    case "move":
      return "Move Container";
    case "move-document":
      return "Move Document";
    case "share-peer":
      return "Share Container";
    case "rename":
      return "Rename Container";
    case "create-child":
      return "Create Child";
  }
}

function getExplorerModalSubmitLabel(
  modalState: ExplorerModalState,
  isSubmittingModal: boolean,
): string {
  if (!isSubmittingModal) {
    switch (modalState.mode) {
      case "delete":
        return "Delete";
      case "link-document":
        return "Link";
      case "move":
        return "Move";
      case "move-document":
        return "Move";
      case "share-peer":
        return "Share";
      case "rename":
        return "Rename";
      case "create-child":
        return "Create";
    }
  }

  switch (modalState.mode) {
    case "delete":
      return "Deleting...";
    case "link-document":
      return "Linking...";
    case "move":
      return "Moving...";
    case "move-document":
      return "Moving...";
    case "share-peer":
      return "Sharing...";
    case "rename":
      return "Renaming...";
    case "create-child":
      return "Creating...";
  }
}

function isExplorerModalSubmitDisabled(params: {
  draftName: string;
  draftTargetContainerId: string;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState;
  peerUserId: string | null;
}): boolean {
  const {
    draftName,
    draftTargetContainerId,
    isSubmittingModal,
    modalState,
    peerUserId,
  } = params;
  if (isSubmittingModal) {
    return true;
  }

  const nameIsRequired =
    modalState.mode !== "delete" &&
    modalState.mode !== "link-document" &&
    modalState.mode !== "move" &&
    modalState.mode !== "move-document" &&
    modalState.mode !== "share-peer";
  if (nameIsRequired && draftName.trim().length === 0) {
    return true;
  }

  if (
    (modalState.mode === "link-document" ||
      modalState.mode === "move" ||
      modalState.mode === "move-document") &&
    draftTargetContainerId.length === 0
  ) {
    return true;
  }

  if (modalState.mode === "share-peer" && !peerUserId) {
    return true;
  }

  return false;
}

function ExplorerModalBody(params: {
  draftName: string;
  draftTargetContainerId: string;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState;
  moveTargetOptions: ReadonlyArray<MoveTargetOption>;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  peerUserId: string | null;
  setDraftName: (value: string) => void;
  setModalError: (error: string | null) => void;
  setDraftTargetContainerId: (value: string) => void;
}) {
  const {
    draftName,
    draftTargetContainerId,
    isSubmittingModal,
    modalState,
    moveTargetOptions,
    nameInputRef,
    peerUserId,
    setDraftName,
    setModalError,
    setDraftTargetContainerId,
  } = params;

  if (modalState.mode === "delete") {
    return <div className="explorer-modal-copy">Delete this container?</div>;
  }

  if (modalState.mode === "share-peer") {
    return (
      <div className="explorer-modal-copy">
        {peerUserId
          ? `Share this container with peer user ${peerUserId}?`
          : "No peer user is available."}
      </div>
    );
  }

  if (
    modalState.mode === "link-document" ||
    modalState.mode === "move" ||
    modalState.mode === "move-document"
  ) {
    return (
      <label className="explorer-modal-field">
        Destination
        <select
          aria-label="Destination container"
          disabled={isSubmittingModal}
          value={draftTargetContainerId}
          onChange={(event) => {
            setModalError(null);
            setDraftTargetContainerId(event.target.value);
          }}
        >
          {moveTargetOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="explorer-modal-field">
      Name
      <input
        ref={nameInputRef}
        aria-label="Container name"
        disabled={isSubmittingModal}
        value={draftName}
        onChange={(event) => {
          setModalError(null);
          setDraftName(event.target.value);
        }}
      />
    </label>
  );
}

function ExplorerModalLayer(params: {
  closeModal: () => void;
  draftName: string;
  draftTargetContainerId: string;
  handleModalSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSubmittingModal: boolean;
  modalError: string | null;
  modalState: ExplorerModalState | null;
  moveTargetOptions: ReadonlyArray<MoveTargetOption>;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  peerUserId: string | null;
  setDraftName: (value: string) => void;
  setModalError: (error: string | null) => void;
  setDraftTargetContainerId: (value: string) => void;
}) {
  const {
    closeModal,
    draftName,
    draftTargetContainerId,
    handleModalSubmit,
    isSubmittingModal,
    modalError,
    modalState,
    moveTargetOptions,
    nameInputRef,
    peerUserId,
    setDraftName,
    setModalError,
    setDraftTargetContainerId,
  } = params;

  if (!modalState) {
    return null;
  }

  return (
    <div className="explorer-modal-backdrop" role="presentation">
      <div
        className="explorer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explorer-modal-title"
      >
        <form className="explorer-modal-form" onSubmit={handleModalSubmit}>
          <h2 id="explorer-modal-title">{getExplorerModalTitle(modalState)}</h2>
          <ExplorerModalBody
            draftName={draftName}
            draftTargetContainerId={draftTargetContainerId}
            isSubmittingModal={isSubmittingModal}
            modalState={modalState}
            moveTargetOptions={moveTargetOptions}
            nameInputRef={nameInputRef}
            peerUserId={peerUserId}
            setDraftName={setDraftName}
            setModalError={setModalError}
            setDraftTargetContainerId={setDraftTargetContainerId}
          />
          {modalError && (
            <div className="explorer-modal-error">{modalError}</div>
          )}
          <div className="explorer-modal-actions">
            <button
              type="button"
              disabled={isSubmittingModal}
              onClick={closeModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isExplorerModalSubmitDisabled({
                draftName,
                draftTargetContainerId,
                isSubmittingModal,
                modalState,
                peerUserId,
              })}
            >
              {getExplorerModalSubmitLabel(modalState, isSubmittingModal)}
            </button>
          </div>
        </form>
      </div>
    </div>
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
    apiClient: appData.apiClient,
    blobStore: appData.blobStore,
    cacheReferencedPrincipalPolicies: appData.cacheReferencedPrincipalPolicies,
    dbStatus: appData.dbStatus,
    domainScope: appData.domainScope,
    encapsulationKeyPair: appData.encapsulationKeyPair,
    events: appData.events,
    execSql: appData.execSql,
    isAuthenticated: appData.isAuthenticated,
    knownDocumentIds,
    log: appData.log,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    online: appData.online,
    replaceDocumentLinksBatch,
  });

  return useExplorerRefreshAction({
    apiClient: appData.apiClient,
    cacheReferencedPrincipalPolicies: appData.cacheReferencedPrincipalPolicies,
    execSql: appData.execSql,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh: explorer.refresh,
  });
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
  const selectedDocumentMoveTargetOptions = selectedDocument
    ? getDocumentMoveTargetOptions(
        nodes,
        documentSummaries,
        selectedDocument.id,
      )
    : [];
  const selectedDocumentLinkTargetOptions = selectedDocument
    ? getDocumentLinkTargetOptions(
        nodes,
        documentSummaries,
        selectedDocument.id,
        selectedDocumentLinkedContainerIds,
      )
    : [];

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
  const { openInlineDriverLicense, openInlineNote } = useInlineDocumentOpeners({
    expandNode: selection.expandNode,
    mergeDocumentSummary,
    setSelectedId: selection.setSelectedId,
  });
  return {
    activateLinkedContainer: selectedNoteStructuralState.activateLinkedDocument,
    contextMenuState,
    modalState,
    openInlineDriverLicense,
    openInlineNote,
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
    openInlineDriverLicense,
    openInlineNote,
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
    openInlineDriverLicense,
    openInlineNote,
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
        openInlineDriverLicense={model.openInlineDriverLicense}
        openInlineNote={model.openInlineNote}
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
        openInlineDriverLicense={model.openInlineDriverLicense}
        openInlineNote={model.openInlineNote}
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
      />
    </div>
  );
}
