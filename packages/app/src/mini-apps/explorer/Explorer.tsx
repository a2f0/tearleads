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
import { NotesApp } from "../notes/NotesApp";
import {
  primeNotesStore,
  subscribeToPersistedNotes,
} from "../notes/NotesProvider";
import {
  type NoteSummary,
  sqlNotesPersistence,
  upsertDiscoveredNotes,
} from "../notes/notesPersistence";
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
  | { mode: "link-note"; noteId: string }
  | { mode: "move"; nodeId: string }
  | { mode: "move-note"; noteId: string }
  | { mode: "rename"; nodeId: string }
  | { mode: "share-peer"; nodeId: string };

interface MoveTargetOption {
  id: string;
  label: string;
}

interface NoteContainerProjection {
  containerId: string;
  noteId: string;
  title: string;
  updatedAt: string;
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

function getNoteMoveTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  noteSummaries: ReadonlyArray<NoteSummary>,
  noteId: string,
): ReadonlyArray<MoveTargetOption> {
  const movingNote = noteSummaries.find((note) => note.id === noteId);
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

function getNoteLinkTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  noteSummaries: ReadonlyArray<NoteSummary>,
  noteId: string,
  linkedContainerIds: ReadonlyArray<string>,
): ReadonlyArray<MoveTargetOption> {
  const linkingNote = noteSummaries.find((note) => note.id === noteId);
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

function getMovedNoteContainerId(
  document: ContainerDocumentSummary,
  preferredContainerId: string,
): string | null {
  if (document.linkedContainerIds.includes(preferredContainerId)) {
    return preferredContainerId;
  }

  return document.linkedContainerIds[0] ?? null;
}

async function moveExplorerNoteDocument(params: {
  appData: ReturnType<typeof useAppData>;
  note: NoteSummary;
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

  const nextContainerId = getMovedNoteContainerId(
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

async function linkExplorerNoteDocument(params: {
  appData: ReturnType<typeof useAppData>;
  note: NoteSummary;
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

async function unlinkExplorerNoteDocument(params: {
  appData: ReturnType<typeof useAppData>;
  note: NoteSummary;
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
  notesByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<NoteContainerProjection>
  >,
  selectedId: string | null,
  onSelectContainer: (id: string) => void,
  onSelectNote: (noteId: string, containerId: string) => void,
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
            notesByContainerId,
            selectedId,
            onSelectContainer,
            onSelectNote,
            onToggleCollapsed,
            onContextMenu,
          )}
        {!isCollapsed
          ? (notesByContainerId.get(entry.node.id) ?? []).map(
              ({ containerId, noteId, title }) => (
                <div
                  className="explorer-sidebar-row"
                  key={`${noteId}:${containerId}`}
                  style={{
                    paddingLeft: `calc(var(--padding) / 2 + (var(--padding) * ${depth + 1}))`,
                  }}
                >
                  <span className="explorer-node-spacer" aria-hidden="true" />
                  <button
                    type="button"
                    data-note-id={noteId}
                    className={
                      "explorer-sidebar-item explorer-sidebar-item--note" +
                      (selectedId === noteId &&
                      activeContainerId === containerId
                        ? " explorer-sidebar-item--selected"
                        : "")
                    }
                    onClick={() => onSelectNote(noteId, containerId)}
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

export function buildNotesByContainerId(
  noteSummaries: ReadonlyArray<NoteSummary>,
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>,
  validContainerIds: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlyArray<NoteContainerProjection>> {
  const nextNotesByContainerId = new Map<string, NoteContainerProjection[]>();

  for (const note of noteSummaries) {
    const linkedContainerIds = note.documentId
      ? linkedContainerIdsByDocumentId.get(note.documentId)
      : undefined;
    const fallbackContainerIds = note.containerId ? [note.containerId] : [];
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

      const existingNotes = nextNotesByContainerId.get(containerId) ?? [];
      existingNotes.push({
        containerId,
        noteId: note.id,
        title: note.title,
        updatedAt: note.updatedAt,
      });
      nextNotesByContainerId.set(containerId, existingNotes);
    }
  }

  for (const notes of nextNotesByContainerId.values()) {
    notes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  return nextNotesByContainerId;
}

function getKnownDocumentIds(
  noteSummaries: ReadonlyArray<NoteSummary>,
): ReadonlySet<string> {
  return new Set(
    noteSummaries.flatMap((note) => (note.documentId ? [note.documentId] : [])),
  );
}

function mergeSingleNoteSummaryList(
  currentNoteSummaries: ReadonlyArray<NoteSummary>,
  nextNote: NoteSummary,
): ReadonlyArray<NoteSummary> {
  const existingNoteIndex = currentNoteSummaries.findIndex(
    (note) => note.id === nextNote.id,
  );

  if (existingNoteIndex < 0) {
    return [...currentNoteSummaries, nextNote];
  }

  const existingNote = currentNoteSummaries[existingNoteIndex];
  if (!existingNote) {
    return currentNoteSummaries;
  }

  if (
    existingNote.title === nextNote.title &&
    existingNote.containerId === nextNote.containerId &&
    existingNote.documentId === nextNote.documentId
  ) {
    return currentNoteSummaries;
  }

  const nextNoteSummaries = [...currentNoteSummaries];
  nextNoteSummaries[existingNoteIndex] = nextNote;
  return nextNoteSummaries;
}

function getRequestedDocumentIds(
  noteSummaries: ReadonlyArray<NoteSummary>,
): ReadonlyArray<string> {
  return Array.from(
    new Set(
      noteSummaries.flatMap((note) =>
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

function mergeNoteSummaryLists(
  currentNoteSummaries: ReadonlyArray<NoteSummary>,
  nextNotes: ReadonlyArray<NoteSummary>,
): ReadonlyArray<NoteSummary> {
  if (nextNotes.length === 0) {
    return currentNoteSummaries;
  }

  let changed = false;
  const nextNoteSummaries = [...currentNoteSummaries];

  for (const nextNote of nextNotes) {
    const existingNoteIndex = nextNoteSummaries.findIndex(
      (note) => note.id === nextNote.id,
    );

    if (existingNoteIndex < 0) {
      nextNoteSummaries.push(nextNote);
      changed = true;
      continue;
    }

    const existingNote = nextNoteSummaries[existingNoteIndex];
    if (
      !existingNote ||
      (existingNote.title === nextNote.title &&
        existingNote.containerId === nextNote.containerId &&
        existingNote.documentId === nextNote.documentId)
    ) {
      continue;
    }

    nextNoteSummaries[existingNoteIndex] = nextNote;
    changed = true;
  }

  return changed ? nextNoteSummaries : currentNoteSummaries;
}

function createNotesRuntimeFromExplorer(
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

async function primeExplorerNoteStoreForStructuralMutation(params: {
  appData: ReturnType<typeof useAppData>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  note: NoteSummary;
}) {
  const { appData, mergeNoteSummary, note } = params;
  if (!note.containerId || !note.documentId) {
    return null;
  }

  const noteStore = primeNotesStore(
    appData.domainScope,
    note.id,
    createNotesRuntimeFromExplorer(
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
    mergeNoteSummary,
    note.documentId,
  );
  if (!(await noteStore.ensureInitialized())) {
    appData.log(`Explorer: note ${note.id} is not ready to mutate locally`);
    return null;
  }

  return noteStore;
}

function useExplorerSelection(
  nodes: ReadonlyArray<ContainerNode>,
  noteSummaries: ReadonlyArray<NoteSummary>,
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
    const selectedMatchesNote = noteSummaries.some(
      (note) => note.id === selectedId,
    );

    if (!selectedId || (!selectedMatchesContainer && !selectedMatchesNote)) {
      setSelectedId(nodes[0]?.id ?? null);
    }
  }, [nodes, noteSummaries, selectedId]);

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
  const selectedNote = noteSummaries.find((note) => note.id === selectedId);

  return {
    activeContainerId: selectedNote?.containerId ?? selectedNode?.id ?? null,
    collapsedIds,
    expandNode,
    selectedId,
    selectedNode,
    selectedNote,
    setSelectedId,
    toggleCollapsed,
  };
}

function useExplorerNoteSummaryState(
  dbStatus: ReturnType<typeof useAppData>["dbStatus"],
  domainScope: ReturnType<typeof useAppData>["domainScope"],
  execSql: ReturnType<typeof useAppData>["execSql"],
  nodes: ReadonlyArray<ContainerNode>,
) {
  const [noteSummaries, setNoteSummaries] = useState<
    ReadonlyArray<NoteSummary>
  >([]);

  useEffect(() => {
    if (dbStatus !== "ready") {
      setNoteSummaries([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      await sqlDocumentContainerProjectionPersistence.ensureSchema(execSql);
      await sqlNotesPersistence.ensureSchema(execSql);
      const storedNotes = await sqlNotesPersistence.listNotes(execSql);
      const validContainerIds = new Set(nodes.map((node) => node.id));
      const visibleNotes = storedNotes.filter(
        (note) => note.containerId && validContainerIds.has(note.containerId),
      );

      if (!cancelled) {
        setNoteSummaries((currentNoteSummaries) => {
          const visibleNotesById = new Map(
            visibleNotes.map((note) => [note.id, note]),
          );
          const pendingVisibleNotes = currentNoteSummaries.filter(
            (note) =>
              note.containerId &&
              validContainerIds.has(note.containerId) &&
              !visibleNotesById.has(note.id),
          );

          return [...visibleNotes, ...pendingVisibleNotes];
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dbStatus, domainScope, execSql, nodes]);

  const mergeNoteSummary = useCallback((nextNote: NoteSummary) => {
    setNoteSummaries((currentNoteSummaries) =>
      mergeSingleNoteSummaryList(currentNoteSummaries, nextNote),
    );
  }, []);

  const mergeNoteSummaries = useCallback(
    (nextNotes: ReadonlyArray<NoteSummary>) => {
      setNoteSummaries((currentNoteSummaries) =>
        mergeNoteSummaryLists(currentNoteSummaries, nextNotes),
      );
    },
    [],
  );

  useEffect(() => {
    return subscribeToPersistedNotes(domainScope, mergeNoteSummary);
  }, [domainScope, mergeNoteSummary]);

  return { mergeNoteSummaries, mergeNoteSummary, noteSummaries };
}

function useNoteLinkedContainerIdsByDocumentId(params: {
  dbStatus: ReturnType<typeof useAppData>["dbStatus"];
  documentLinkProjectionVersion: number;
  execSql: ReturnType<typeof useAppData>["execSql"];
  noteSummaries: ReadonlyArray<NoteSummary>;
}) {
  const { dbStatus, documentLinkProjectionVersion, execSql, noteSummaries } =
    params;
  const [linkedContainerIdsByDocumentId, setLinkedContainerIdsByDocumentId] =
    useState<ReadonlyMap<string, ReadonlyArray<string>>>(new Map());
  const linkedContainerIdsLoadVersionRef = useRef(0);
  const requestedDocumentIds = useMemo(
    () => getRequestedDocumentIds(noteSummaries),
    [noteSummaries],
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
    if (dbStatus !== "ready") {
      setLinkedContainerIdsByDocumentId(new Map());
      return;
    }

    if (requestedDocumentIds.length === 0) {
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

  return {
    linkedContainerIdsByDocumentId,
    setLinkedContainerIdsForDocument,
  };
}

function useDiscoveredNotesSync(params: {
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
  mergeNoteSummaries: (nextNotes: ReadonlyArray<NoteSummary>) => void;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
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
    mergeNoteSummaries,
    mergeNoteSummary,
    online,
    replaceDocumentLinksBatch,
  } = params;
  const { primeDiscoveredNotes } = usePrimeDiscoveredNotes({
    apiClient,
    blobStore,
    cacheReferencedPrincipalPolicies,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    execSql,
    isAuthenticated,
    log,
    mergeNoteSummary,
    online,
  });

  const discoverDocumentsForContainer = useCallback(
    (containerId: string) => {
      let cancelled = false;

      void (async () => {
        try {
          const discoveredNoteSummaries = await discoverContainerDocuments({
            cacheReferencedPrincipalPolicies,
            containerId,
            listContainerDocuments: (nextContainerId) =>
              apiClient.listContainerDocuments(nextContainerId),
            replaceDocumentLinksBatch,
            upsertDiscoveredNotes: (inputs) =>
              upsertDiscoveredNotes(execSql, inputs),
          });

          if (!discoveredNoteSummaries || cancelled) {
            return;
          }

          mergeNoteSummaries(discoveredNoteSummaries);
          primeDiscoveredNotes(discoveredNoteSummaries);
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
      mergeNoteSummaries,
      primeDiscoveredNotes,
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

  return { primeDiscoveredNotes };
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

function usePrimeDiscoveredNotes(params: {
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
  mergeNoteSummary: (nextNote: NoteSummary) => void;
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
    mergeNoteSummary,
    online,
  } = params;

  const primeDiscoveredNotes = useCallback(
    (discoveredNoteSummaries: ReadonlyArray<NoteSummary>) => {
      for (const noteSummary of discoveredNoteSummaries) {
        if (!noteSummary.containerId) {
          continue;
        }

        const notesStore = primeNotesStore(
          domainScope,
          noteSummary.id,
          createNotesRuntimeFromExplorer(
            apiClient,
            blobStore,
            cacheReferencedPrincipalPolicies,
            noteSummary.containerId,
            dbStatus,
            domainScope,
            encapsulationKeyPair,
            execSql,
            isAuthenticated,
            log,
            online,
          ),
          mergeNoteSummary,
          noteSummary.documentId,
        );
        notesStore.requestSync();
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
      mergeNoteSummary,
      online,
    ],
  );

  return { primeDiscoveredNotes };
}

function useExplorerRefreshAction(params: {
  apiClient: ReturnType<typeof useAppData>["apiClient"];
  cacheReferencedPrincipalPolicies: ReturnType<
    typeof useAppData
  >["cacheReferencedPrincipalPolicies"];
  execSql: ReturnType<typeof useAppData>["execSql"];
  mergeNoteSummaries: (nextNotes: ReadonlyArray<NoteSummary>) => void;
  primeDiscoveredNotes: (nextNotes: ReadonlyArray<NoteSummary>) => void;
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
    mergeNoteSummaries,
    primeDiscoveredNotes,
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

      const discoveredNoteSummaries = await discoverAllContainerDocuments({
        cacheReferencedPrincipalPolicies,
        containerIds: remoteContainers.map((container) => container.id),
        listContainerDocuments: (containerId) =>
          apiClient.listContainerDocuments(containerId),
        replaceDocumentLinksBatch,
        upsertDiscoveredNotes: (inputs) =>
          upsertDiscoveredNotes(execSql, inputs),
      });

      mergeNoteSummaries(discoveredNoteSummaries);
      primeDiscoveredNotes(discoveredNoteSummaries);
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
    mergeNoteSummaries,
    primeDiscoveredNotes,
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
    case "link-note":
      return "Failed to link note.";
    case "move":
      return "Failed to move container.";
    case "move-note":
      return "Failed to move note.";
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
    case "link-note":
      return "Failed to link note:";
    case "move":
      return "Failed to move container:";
    case "move-note":
      return "Failed to move note:";
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
      modalState.mode === "link-note" ||
      modalState.mode === "move" ||
      modalState.mode === "move-note" ||
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
  noteSummaries: ReadonlyArray<NoteSummary>;
  selectedNoteLinkedContainerIds: ReadonlyArray<string>;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
}) {
  const {
    nodes,
    noteSummaries,
    selectedNoteLinkedContainerIds,
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

  const openMoveNoteModal = useCallback(
    (noteId: string) => {
      const moveTargetOptions = getNoteMoveTargetOptions(
        nodes,
        noteSummaries,
        noteId,
      );
      if (moveTargetOptions.length === 0) {
        return;
      }

      setModalState({ mode: "move-note", noteId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId(moveTargetOptions[0]?.id ?? "");
    },
    [
      nodes,
      noteSummaries,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  const openLinkNoteModal = useCallback(
    (noteId: string) => {
      const linkTargetOptions = getNoteLinkTargetOptions(
        nodes,
        noteSummaries,
        noteId,
        selectedNoteLinkedContainerIds,
      );
      if (linkTargetOptions.length === 0) {
        return;
      }

      setModalState({ mode: "link-note", noteId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId(linkTargetOptions[0]?.id ?? "");
    },
    [
      nodes,
      noteSummaries,
      selectedNoteLinkedContainerIds,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  return {
    openLinkNoteModal,
    openMoveModal,
    openMoveNoteModal,
  };
}

function useExplorerModalOpeners(params: {
  nodes: ReadonlyArray<ContainerNode>;
  noteSummaries: ReadonlyArray<NoteSummary>;
  selectedNoteLinkedContainerIds: ReadonlyArray<string>;
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
  noteSummaries: ReadonlyArray<NoteSummary>,
  selectedNoteLinkedContainerIds: ReadonlyArray<string>,
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
    noteSummaries,
    selectedNoteLinkedContainerIds,
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
  linkNote: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<NoteSummary | null>;
  modalState: ExplorerModalState | null;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  moveNote: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<NoteSummary | null>;
  nodes: ReadonlyArray<ContainerNode>;
  noteSummaries: ReadonlyArray<NoteSummary>;
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

async function submitExplorerMoveNoteModal(params: {
  clearModal: () => void;
  linkNote: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<NoteSummary | null>;
  modalState:
    | { mode: "link-note"; noteId: string }
    | { mode: "move-note"; noteId: string };
  moveNote: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<NoteSummary | null>;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  targetContainerId: string;
}) {
  const {
    clearModal,
    linkNote,
    modalState,
    moveNote,
    setModalError,
    setSelectedId,
    targetContainerId,
  } = params;

  if (!targetContainerId) {
    setModalError("Choose a destination container.");
    return;
  }

  const movedNote =
    modalState.mode === "link-note"
      ? await linkNote(modalState.noteId, targetContainerId)
      : await moveNote(modalState.noteId, targetContainerId);
  if (!movedNote) {
    setModalError(
      modalState.mode === "link-note"
        ? "Failed to link note."
        : "Failed to move note.",
    );
    return;
  }

  setSelectedId(movedNote.id);
  clearModal();
}

async function submitExplorerNonNameModal(params: {
  clearModal: () => void;
  deleteContainer: (containerId: string) => Promise<boolean>;
  draftTargetContainerId: string;
  modalState:
    | { mode: "delete"; nodeId: string }
    | { mode: "link-note"; noteId: string }
    | { mode: "move"; nodeId: string }
    | { mode: "move-note"; noteId: string }
    | { mode: "share-peer"; nodeId: string };
  linkNote: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<NoteSummary | null>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  moveNote: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<NoteSummary | null>;
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
    case "link-note":
    case "move-note":
      await submitExplorerMoveNoteModal({
        clearModal: params.clearModal,
        linkNote: params.linkNote,
        modalState,
        moveNote: params.moveNote,
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
    linkNote,
    modalState,
    moveContainer,
    moveNote,
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
      linkNote,
      modalState,
      moveContainer,
      moveNote,
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
    linkNote,
    modalState,
    moveContainer,
    moveNote,
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
  linkNote: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<NoteSummary | null>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  moveNote: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<NoteSummary | null>;
  nodes: ReadonlyArray<ContainerNode>;
  noteSummaries: ReadonlyArray<NoteSummary>;
  peerUserId: string | null;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  setSelectedId: (id: string | null) => void;
  selectedNoteLinkedContainerIds: ReadonlyArray<string>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const modalState = useExplorerModalState(
    params.nodes,
    params.noteSummaries,
    params.selectedNoteLinkedContainerIds,
  );
  const moveTargetOptions =
    modalState.modalState?.mode === "move"
      ? getMoveTargetOptions(params.nodes, modalState.modalState.nodeId)
      : modalState.modalState?.mode === "link-note"
        ? getNoteLinkTargetOptions(
            params.nodes,
            params.noteSummaries,
            modalState.modalState.noteId,
            params.selectedNoteLinkedContainerIds,
          )
        : modalState.modalState?.mode === "move-note"
          ? getNoteMoveTargetOptions(
              params.nodes,
              params.noteSummaries,
              modalState.modalState.noteId,
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
    openLinkNoteModal: modalState.openLinkNoteModal,
    openMoveModal: modalState.openMoveModal,
    openMoveNoteModal: modalState.openMoveNoteModal,
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
  notesByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<NoteContainerProjection>
  >;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
  selectedId: string | null;
  selectNoteProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  setSidebar: (sidebar: ReactNode | null) => void;
  toggleCollapsed: (nodeId: string) => void;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    activeContainerId,
    collapsedIds,
    handleSidebarContextMenu,
    notesByContainerId,
    nodes,
    ready,
    selectedId,
    selectNoteProjection,
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
            notesByContainerId,
            selectedId,
            setSelectedId,
            selectNoteProjection,
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
      notesByContainerId,
      ready,
      selectedId,
      selectNoteProjection,
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

function useInlineNoteAction(params: {
  expandNode: (nodeId: string) => void;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const { expandNode, mergeNoteSummary, setSelectedId } = params;

  return useCallback(
    (containerId: string, noteId?: string) => {
      const nextNoteId = noteId ?? crypto.randomUUID();

      if (!noteId) {
        mergeNoteSummary({
          id: nextNoteId,
          containerId,
          documentId: null,
          title: "Untitled note",
          updatedAt: new Date().toISOString(),
        });
      }

      setSelectedId(nextNoteId);
      expandNode(containerId);
    },
    [expandNode, mergeNoteSummary, setSelectedId],
  );
}

async function moveExplorerNote(params: {
  appData: ReturnType<typeof useAppData>;
  expandNode: (nodeId: string) => void;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  note: NoteSummary;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
  targetContainerId: string;
}) {
  const {
    appData,
    expandNode,
    mergeNoteSummary,
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

  const currentNotesStore = await primeExplorerNoteStoreForStructuralMutation({
    appData,
    mergeNoteSummary,
    note,
  });
  if (!currentNotesStore) {
    return null;
  }

  const movedDocument = await moveExplorerNoteDocument({
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
    currentNotesStore,
    mergeNoteSummary,
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
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  note: NoteSummary;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
  targetContainerId: string;
}) {
  const {
    appData,
    mergeNoteSummary,
    note,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  } = params;
  if (!note.documentId || !note.containerId) {
    return null;
  }

  const currentNotesStore = await primeExplorerNoteStoreForStructuralMutation({
    appData,
    mergeNoteSummary,
    note,
  });
  if (!currentNotesStore) {
    return null;
  }

  const linkedDocument = await linkExplorerNoteDocument({
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
    currentNotesStore,
    mergeNoteSummary,
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
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  note: NoteSummary;
  removedContainerId: string;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
}) {
  const {
    appData,
    mergeNoteSummary,
    note,
    removedContainerId,
    setLinkedContainerIdsForDocument,
  } = params;
  if (!note.documentId || !note.containerId) {
    return null;
  }

  const currentNotesStore = await primeExplorerNoteStoreForStructuralMutation({
    appData,
    mergeNoteSummary,
    note,
  });
  if (!currentNotesStore) {
    return null;
  }

  const unlinkedDocument = await unlinkExplorerNoteDocument({
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

  const nextContainerId = getMovedNoteContainerId(
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
    currentNotesStore,
    mergeNoteSummary,
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
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  note: NoteSummary;
  targetContainerId: string;
}) {
  const { appData, mergeNoteSummary, note, targetContainerId } = params;
  if (
    !note.documentId ||
    !note.containerId ||
    note.containerId === targetContainerId
  ) {
    return null;
  }

  const currentNotesStore = await primeExplorerNoteStoreForStructuralMutation({
    appData,
    mergeNoteSummary,
    note,
  });
  if (!currentNotesStore) {
    return null;
  }

  const relinkedNote = await relinkExplorerNoteLocally({
    accessEpoch: 1,
    appData,
    currentNotesStore,
    mergeNoteSummary,
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
  currentNotesStore: ReturnType<typeof primeNotesStore>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  note: NoteSummary;
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
  currentNotesStore: ReturnType<typeof primeNotesStore>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  note: NoteSummary;
  requestSync: boolean;
  targetContainerId: string;
}) {
  const {
    accessEpoch,
    appData,
    currentNotesStore,
    mergeNoteSummary,
    note,
    requestSync,
    targetContainerId,
  } = params;
  if (!note.documentId) {
    return null;
  }

  const relinkedNote = await currentNotesStore.relink({
    accessEpoch,
    containerId: targetContainerId,
    documentId: note.documentId,
    noteId: note.id,
  });
  if (!relinkedNote) {
    appData.log(
      `Explorer: note ${note.id} could not be relinked after a structural mutation`,
    );
    return null;
  }

  mergeNoteSummary(relinkedNote);
  currentNotesStore.updateRuntime(
    createNotesRuntimeFromExplorer(
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
    currentNotesStore.requestSync();
  }
  return relinkedNote;
}

function useMoveNoteAction(params: {
  appData: ReturnType<typeof useAppData>;
  expandNode: (nodeId: string) => void;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  noteSummaries: ReadonlyArray<NoteSummary>;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
}) {
  const {
    appData,
    expandNode,
    mergeNoteSummary,
    noteSummaries,
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

      const existingNote = noteSummaries.find((note) => note.id === noteId);
      if (!existingNote) {
        return null;
      }

      const movedNote = await moveExplorerNote({
        appData,
        expandNode,
        mergeNoteSummary,
        note: existingNote,
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
      mergeNoteSummary,
      noteSummaries,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useLinkNoteAction(params: {
  appData: ReturnType<typeof useAppData>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  noteSummaries: ReadonlyArray<NoteSummary>;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
}) {
  const {
    appData,
    mergeNoteSummary,
    noteSummaries,
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

      const existingNote = noteSummaries.find((note) => note.id === noteId);
      if (!existingNote) {
        return null;
      }

      const linkedNote = await linkExplorerNote({
        appData,
        mergeNoteSummary,
        note: existingNote,
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
      mergeNoteSummary,
      noteSummaries,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useUnlinkNoteAction(params: {
  appData: ReturnType<typeof useAppData>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  noteSummaries: ReadonlyArray<NoteSummary>;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
}) {
  const {
    appData,
    mergeNoteSummary,
    noteSummaries,
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

      const existingNote = noteSummaries.find((note) => note.id === noteId);
      if (!existingNote) {
        return null;
      }

      const unlinkedNote = await unlinkExplorerLinkedNote({
        appData,
        mergeNoteSummary,
        note: existingNote,
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
      mergeNoteSummary,
      noteSummaries,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useActivateLinkedNoteAction(params: {
  appData: ReturnType<typeof useAppData>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  noteSummaries: ReadonlyArray<NoteSummary>;
}) {
  const { appData, mergeNoteSummary, noteSummaries } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (appData.dbStatus !== "ready") {
        return null;
      }

      const existingNote = noteSummaries.find((note) => note.id === noteId);
      if (!existingNote) {
        return null;
      }

      return activateExplorerLinkedNote({
        appData,
        mergeNoteSummary,
        note: existingNote,
        targetContainerId,
      });
    },
    [appData, mergeNoteSummary, noteSummaries],
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

function ExplorerNoteDetailActions(params: {
  canLinkSelectedNote: boolean;
  canMoveSelectedNote: boolean;
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  openLinkNoteModal: (noteId: string) => void;
  openMoveNoteModal: (noteId: string) => void;
  ready: boolean;
  selectedNote: NoteSummary;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    canLinkSelectedNote,
    canMoveSelectedNote,
    handleRefresh,
    isRefreshing,
    openLinkNoteModal,
    openMoveNoteModal,
    ready,
    selectedNote,
    setSelectedId,
  } = params;

  return (
    <div className="explorer-detail-actions">
      <button
        type="button"
        className="explorer-action-button"
        onClick={() => {
          if (selectedNote.containerId) {
            setSelectedId(selectedNote.containerId);
          }
        }}
      >
        Back to Container
      </button>
      <button
        type="button"
        className="explorer-action-button"
        disabled={!canLinkSelectedNote}
        onClick={() => {
          openLinkNoteModal(selectedNote.id);
        }}
      >
        Link
      </button>
      <button
        type="button"
        className="explorer-action-button"
        disabled={!canMoveSelectedNote}
        onClick={() => {
          openMoveNoteModal(selectedNote.id);
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
  ) => Promise<NoteSummary | null>;
  canActivateSelectedNote: boolean;
  canUnlinkSelectedNote: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedNote: NoteSummary;
  setSelectedId: (id: string | null) => void;
  unlinkNote: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<NoteSummary | null>;
}) {
  const {
    activateLinkedContainer,
    canActivateSelectedNote,
    canUnlinkSelectedNote,
    linkedContainerIds,
    nodes,
    selectedNote,
    setSelectedId,
    unlinkNote,
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
    selectedNote.containerId,
  );

  return (
    <div className="explorer-linked-container-section">
      <strong>Linked Containers</strong>
      <ul className="explorer-linked-container-list">
        {linkedContainers.map((linkedContainer) => (
          <ExplorerLinkedContainerRow
            activateLinkedContainer={activateLinkedContainer}
            activatingContainerId={activatingContainerId}
            canActivateSelectedNote={canActivateSelectedNote}
            canUnlinkSelectedNote={canUnlinkSelectedNote}
            key={linkedContainer.id}
            linkedContainer={linkedContainer}
            selectedNoteId={selectedNote.id}
            setActionError={setActionError}
            setActivatingContainerId={setActivatingContainerId}
            setSelectedId={setSelectedId}
            setUnlinkingContainerId={setUnlinkingContainerId}
            unlinkingContainerId={unlinkingContainerId}
            unlinkNote={unlinkNote}
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
  ) => Promise<NoteSummary | null>;
  activatingContainerId: string | null;
  canActivateSelectedNote: boolean;
  canUnlinkSelectedNote: boolean;
  linkedContainer: LinkedContainerDetail;
  selectedNoteId: string;
  setActionError: (error: string | null) => void;
  setActivatingContainerId: (containerId: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setUnlinkingContainerId: (containerId: string | null) => void;
  unlinkingContainerId: string | null;
  unlinkNote: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<NoteSummary | null>;
}) {
  const {
    activateLinkedContainer,
    canActivateSelectedNote,
    canUnlinkSelectedNote,
    activatingContainerId,
    linkedContainer,
    selectedNoteId,
    setActionError,
    setActivatingContainerId,
    setSelectedId,
    setUnlinkingContainerId,
    unlinkingContainerId,
    unlinkNote,
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
              !canActivateSelectedNote ||
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
                selectedNoteId,
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
            !canUnlinkSelectedNote ||
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
              selectedNoteId,
              setActionError,
              setUnlinkingContainerId,
              unlinkNote,
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
  ) => Promise<NoteSummary | null>;
  linkedContainer: LinkedContainerDetail;
  selectedNoteId: string;
  setActionError: (error: string | null) => void;
  setActivatingContainerId: (containerId: string | null) => void;
}) {
  const {
    activateLinkedContainer,
    linkedContainer,
    selectedNoteId,
    setActionError,
    setActivatingContainerId,
  } = params;

  setActionError(null);
  setActivatingContainerId(linkedContainer.id);
  try {
    const activatedNote = await activateLinkedContainer(
      selectedNoteId,
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
  selectedNoteId: string;
  setActionError: (error: string | null) => void;
  setUnlinkingContainerId: (containerId: string | null) => void;
  unlinkNote: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<NoteSummary | null>;
}) {
  const {
    linkedContainer,
    selectedNoteId,
    setActionError,
    setUnlinkingContainerId,
    unlinkNote,
  } = params;

  setActionError(null);
  setUnlinkingContainerId(linkedContainer.id);
  try {
    const unlinkedNote = await unlinkNote(selectedNoteId, linkedContainer.id);
    if (!unlinkedNote) {
      setActionError(`Failed to detach ${linkedContainer.label}.`);
    }
  } catch {
    setActionError(`Failed to detach ${linkedContainer.label}.`);
  } finally {
    setUnlinkingContainerId(null);
  }
}

function ExplorerNoteDetail(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<NoteSummary | null>;
  canActivateSelectedNote: boolean;
  canLinkSelectedNote: boolean;
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  canMoveSelectedNote: boolean;
  canUnlinkSelectedNote: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  openLinkNoteModal: (noteId: string) => void;
  openMoveNoteModal: (noteId: string) => void;
  ready: boolean;
  refreshError: string | null;
  selectedNote: NoteSummary;
  setSelectedId: (id: string | null) => void;
  unlinkNote: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<NoteSummary | null>;
}) {
  const selectedNoteContainer = params.selectedNote.containerId
    ? params.nodes.find((node) => node.id === params.selectedNote.containerId)
    : null;

  return (
    <div
      className="explorer-detail explorer-detail--note"
      key={params.selectedNote.id}
    >
      <div className="explorer-detail-header">
        <div className="explorer-detail-copy">
          <strong>{params.selectedNote.title}</strong>
          <span>
            note
            {selectedNoteContainer ? ` in ${selectedNoteContainer.name}` : ""}
          </span>
        </div>
        <ExplorerNoteDetailActions
          canLinkSelectedNote={params.canLinkSelectedNote}
          canMoveSelectedNote={params.canMoveSelectedNote}
          handleRefresh={params.handleRefresh}
          isRefreshing={params.isRefreshing}
          openLinkNoteModal={params.openLinkNoteModal}
          openMoveNoteModal={params.openMoveNoteModal}
          ready={params.ready}
          selectedNote={params.selectedNote}
          setSelectedId={params.setSelectedId}
        />
      </div>
      {params.refreshError ? (
        <span className="explorer-detail-error">{params.refreshError}</span>
      ) : null}
      <ExplorerLinkedContainerSection
        activateLinkedContainer={params.activateLinkedContainer}
        canActivateSelectedNote={params.canActivateSelectedNote}
        canUnlinkSelectedNote={params.canUnlinkSelectedNote}
        linkedContainerIds={params.linkedContainerIds}
        nodes={params.nodes}
        selectedNote={params.selectedNote}
        setSelectedId={params.setSelectedId}
        unlinkNote={params.unlinkNote}
      />
      <div className="explorer-inline-note">
        <NotesApp
          noteId={params.selectedNote.id}
          {...(params.selectedNote.containerId === undefined
            ? {}
            : { containerId: params.selectedNote.containerId })}
          {...(params.selectedNote.documentId === undefined
            ? {}
            : { documentId: params.selectedNote.documentId })}
          onPersistedNote={params.mergeNoteSummary}
        />
      </div>
    </div>
  );
}

function ExplorerContainerDetail(params: {
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  openInlineNote: (containerId: string, noteId?: string) => void;
  ready: boolean;
  refreshError: string | null;
  selectedNode: ContainerNode;
}) {
  const {
    handleRefresh,
    isRefreshing,
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
  ) => Promise<NoteSummary | null>;
  canActivateSelectedNote: boolean;
  canLinkSelectedNote: boolean;
  canMoveSelectedNote: boolean;
  canUnlinkSelectedNote: boolean;
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  openInlineNote: (containerId: string, noteId?: string) => void;
  openLinkNoteModal: (noteId: string) => void;
  openMoveNoteModal: (noteId: string) => void;
  ready: boolean;
  refreshError: string | null;
  selectedNode: ContainerNode | undefined;
  selectedNote: NoteSummary | undefined;
  setSelectedId: (id: string | null) => void;
  unlinkNote: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<NoteSummary | null>;
}) {
  const { selectedNode, selectedNote } = params;

  if (selectedNote) {
    return <ExplorerNoteDetail {...params} selectedNote={selectedNote} />;
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
    case "link-note":
      return "Link Note";
    case "move":
      return "Move Container";
    case "move-note":
      return "Move Note";
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
      case "link-note":
        return "Link";
      case "move":
        return "Move";
      case "move-note":
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
    case "link-note":
      return "Linking...";
    case "move":
      return "Moving...";
    case "move-note":
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
    modalState.mode !== "link-note" &&
    modalState.mode !== "move" &&
    modalState.mode !== "move-note" &&
    modalState.mode !== "share-peer";
  if (nameIsRequired && draftName.trim().length === 0) {
    return true;
  }

  if (
    (modalState.mode === "link-note" ||
      modalState.mode === "move" ||
      modalState.mode === "move-note") &&
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
    modalState.mode === "link-note" ||
    modalState.mode === "move" ||
    modalState.mode === "move-note"
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

function useExplorerNoteViewModel(
  appData: ReturnType<typeof useAppData>,
  explorer: ReturnType<typeof useExplorer>,
  documentLinkProjectionVersion: number,
) {
  const { mergeNoteSummaries, mergeNoteSummary, noteSummaries } =
    useExplorerNoteSummaryState(
      appData.dbStatus,
      appData.domainScope,
      appData.execSql,
      explorer.nodes,
    );
  const { linkedContainerIdsByDocumentId, setLinkedContainerIdsForDocument } =
    useNoteLinkedContainerIdsByDocumentId({
      dbStatus: appData.dbStatus,
      documentLinkProjectionVersion,
      execSql: appData.execSql,
      noteSummaries,
    });
  const validContainerIds = useMemo(
    () => new Set(explorer.nodes.map((node) => node.id)),
    [explorer.nodes],
  );
  const notesByContainerId = useMemo(
    () =>
      buildNotesByContainerId(
        noteSummaries,
        linkedContainerIdsByDocumentId,
        validContainerIds,
      ),
    [linkedContainerIdsByDocumentId, noteSummaries, validContainerIds],
  );
  const knownDocumentIds = useMemo(
    () => getKnownDocumentIds(noteSummaries),
    [noteSummaries],
  );
  const selection = useExplorerSelection(explorer.nodes, noteSummaries);

  return {
    knownDocumentIds,
    linkedContainerIdsByDocumentId,
    mergeNoteSummaries,
    mergeNoteSummary,
    noteSummaries,
    notesByContainerId,
    selection,
    setLinkedContainerIdsForDocument,
  };
}

function getSelectedNoteLinkedContainerIds(params: {
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  selectedNote: NoteSummary | undefined;
}) {
  const { linkedContainerIdsByDocumentId, selectedNote } = params;
  if (!selectedNote) {
    return [];
  }

  const fallbackContainerIds =
    selectedNote.containerId === null ? [] : [selectedNote.containerId];
  if (!selectedNote.documentId) {
    return fallbackContainerIds;
  }

  const linkedContainerIds =
    linkedContainerIdsByDocumentId.get(selectedNote.documentId) ?? [];
  return linkedContainerIds.length > 0
    ? linkedContainerIds
    : fallbackContainerIds;
}

function useExplorerInteractionState(params: {
  activeContainerId: string | null;
  appData: ReturnType<typeof useAppData>;
  explorer: ReturnType<typeof useExplorer>;
  knownDocumentIds: ReadonlySet<string>;
  mergeNoteSummaries: (nextNotes: ReadonlyArray<NoteSummary>) => void;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  onDocumentLinksChanged: () => void;
}) {
  const {
    activeContainerId,
    appData,
    explorer,
    knownDocumentIds,
    mergeNoteSummaries,
    mergeNoteSummary,
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
  const { primeDiscoveredNotes } = useDiscoveredNotesSync({
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
    mergeNoteSummaries,
    mergeNoteSummary,
    online: appData.online,
    replaceDocumentLinksBatch,
  });

  return useExplorerRefreshAction({
    apiClient: appData.apiClient,
    cacheReferencedPrincipalPolicies: appData.cacheReferencedPrincipalPolicies,
    execSql: appData.execSql,
    mergeNoteSummaries,
    primeDiscoveredNotes,
    replaceDocumentLinksBatch,
    refresh: explorer.refresh,
  });
}

function useSelectedNoteStructuralState(params: {
  appData: ReturnType<typeof useAppData>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  noteSummaries: ReadonlyArray<NoteSummary>;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
  selectedNote: NoteSummary | undefined;
  expandNode: (nodeId: string) => void;
}) {
  const {
    appData,
    expandNode,
    linkedContainerIdsByDocumentId,
    mergeNoteSummary,
    nodes,
    noteSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
    selectedNote,
  } = params;
  const selectedNoteLinkedContainerIds = getSelectedNoteLinkedContainerIds({
    linkedContainerIdsByDocumentId,
    selectedNote,
  });
  const moveNote = useMoveNoteAction({
    appData,
    expandNode,
    mergeNoteSummary,
    noteSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const activateLinkedNote = useActivateLinkedNoteAction({
    appData,
    mergeNoteSummary,
    noteSummaries,
  });
  const linkNote = useLinkNoteAction({
    appData,
    mergeNoteSummary,
    noteSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const unlinkNote = useUnlinkNoteAction({
    appData,
    mergeNoteSummary,
    noteSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const selectedNoteMoveTargetOptions = selectedNote
    ? getNoteMoveTargetOptions(nodes, noteSummaries, selectedNote.id)
    : [];
  const selectedNoteLinkTargetOptions = selectedNote
    ? getNoteLinkTargetOptions(
        nodes,
        noteSummaries,
        selectedNote.id,
        selectedNoteLinkedContainerIds,
      )
    : [];

  return {
    activateLinkedNote,
    linkNote,
    moveNote,
    selectedNoteLinkedContainerIds,
    selectedNoteLinkTargetOptions,
    selectedNoteMoveTargetOptions,
    unlinkNote,
  };
}

function useSelectNoteProjection(params: {
  activateLinkedNote: (
    noteId: string,
    containerId: string,
  ) => Promise<NoteSummary | null>;
  noteSummaries: ReadonlyArray<NoteSummary>;
  setSelectedId: (id: string | null) => void;
}) {
  const { activateLinkedNote, noteSummaries, setSelectedId } = params;

  return useCallback(
    (noteId: string, containerId: string) => {
      setSelectedId(noteId);
      const existingNote = noteSummaries.find((note) => note.id === noteId);
      if (!existingNote || existingNote.containerId === containerId) {
        return;
      }

      void activateLinkedNote(noteId, containerId);
    },
    [activateLinkedNote, noteSummaries, setSelectedId],
  );
}

function useExplorerPanelState(params: {
  appData: ReturnType<typeof useAppData>;
  explorer: ReturnType<typeof useExplorer>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  noteSummaries: ReadonlyArray<NoteSummary>;
  notesByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<NoteContainerProjection>
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
    mergeNoteSummary,
    noteSummaries,
    notesByContainerId,
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
  const selectedNoteStructuralState = useSelectedNoteStructuralState({
    appData,
    expandNode: selection.expandNode,
    linkedContainerIdsByDocumentId,
    mergeNoteSummary,
    nodes: explorer.nodes,
    noteSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
    selectedNote: selection.selectedNote,
  });
  const selectNoteProjection = useSelectNoteProjection({
    activateLinkedNote: selectedNoteStructuralState.activateLinkedNote,
    noteSummaries,
    setSelectedId: selection.setSelectedId,
  });
  useExplorerSidebarPanel({
    activeContainerId: selection.activeContainerId,
    collapsedIds: selection.collapsedIds,
    handleSidebarContextMenu: contextMenuState.handleSidebarContextMenu,
    notesByContainerId,
    nodes: explorer.nodes,
    ready: explorer.ready,
    selectedId: selection.selectedId,
    selectNoteProjection,
    setSelectedId: selection.setSelectedId,
    setSidebar,
    toggleCollapsed: selection.toggleCollapsed,
    treeEntries,
  });
  const modalState = useExplorerModalController({
    createChild: explorer.createChild,
    deleteContainer: explorer.deleteContainer,
    expandNode: selection.expandNode,
    linkNote: selectedNoteStructuralState.linkNote,
    moveContainer: explorer.moveContainer,
    moveNote: selectedNoteStructuralState.moveNote,
    nodes: explorer.nodes,
    noteSummaries,
    peerUserId,
    renameContainer: explorer.renameContainer,
    setSelectedId: selection.setSelectedId,
    selectedNoteLinkedContainerIds:
      selectedNoteStructuralState.selectedNoteLinkedContainerIds,
    shareWithUser: explorer.shareWithUser,
  });
  const openInlineNote = useInlineNoteAction({
    expandNode: selection.expandNode,
    mergeNoteSummary,
    setSelectedId: selection.setSelectedId,
  });

  return {
    activateLinkedContainer: selectedNoteStructuralState.activateLinkedNote,
    contextMenuState,
    modalState,
    openInlineNote,
    selectedNoteLinkedContainerIds:
      selectedNoteStructuralState.selectedNoteLinkedContainerIds,
    selectedNoteLinkTargetOptions:
      selectedNoteStructuralState.selectedNoteLinkTargetOptions,
    selectedNoteMoveTargetOptions:
      selectedNoteStructuralState.selectedNoteMoveTargetOptions,
    unlinkNote: selectedNoteStructuralState.unlinkNote,
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

function getSelectedNoteMutationState(params: {
  appData: ReturnType<typeof useAppData>;
  selectedNote: NoteSummary | undefined;
  selectedNoteLinkTargetOptions: ReadonlyArray<MoveTargetOption>;
  selectedNoteLinkedContainerIds: ReadonlyArray<string>;
  selectedNoteMoveTargetOptions: ReadonlyArray<MoveTargetOption>;
}) {
  const {
    appData,
    selectedNote,
    selectedNoteLinkTargetOptions,
    selectedNoteLinkedContainerIds,
    selectedNoteMoveTargetOptions,
  } = params;
  const canActivateSelectedNote =
    appData.dbStatus === "ready" && !!selectedNote?.documentId;
  const canMutateSelectedNote =
    canActivateSelectedNote && appData.isAuthenticated && appData.online;

  return {
    canActivateSelectedNote,
    canLinkSelectedNote:
      canMutateSelectedNote && selectedNoteLinkTargetOptions.length > 0,
    canMoveSelectedNote:
      canMutateSelectedNote && selectedNoteMoveTargetOptions.length > 0,
    canUnlinkSelectedNote:
      canMutateSelectedNote && selectedNoteLinkedContainerIds.length > 1,
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
    mergeNoteSummaries,
    mergeNoteSummary,
    noteSummaries,
    notesByContainerId,
    selection,
    setLinkedContainerIdsForDocument,
  } = useExplorerNoteViewModel(
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
      mergeNoteSummaries,
      mergeNoteSummary,
      onDocumentLinksChanged: handleDocumentLinksChanged,
    });
  const {
    activateLinkedContainer,
    contextMenuState,
    modalState,
    openInlineNote,
    selectedNoteLinkedContainerIds,
    selectedNoteLinkTargetOptions,
    selectedNoteMoveTargetOptions,
    unlinkNote,
  } = useExplorerPanelState({
    appData,
    explorer,
    linkedContainerIdsByDocumentId,
    mergeNoteSummary,
    noteSummaries,
    notesByContainerId,
    onDocumentLinksChanged: handleDocumentLinksChanged,
    peerUserId,
    selection,
    setLinkedContainerIdsForDocument,
    setSidebar,
    treeEntries,
  });
  const selectedNoteMutationState = getSelectedNoteMutationState({
    appData,
    selectedNote: selection.selectedNote,
    selectedNoteLinkTargetOptions,
    selectedNoteLinkedContainerIds,
    selectedNoteMoveTargetOptions,
  });

  return {
    activateLinkedContainer,
    ...selectedNoteMutationState,
    contextMenuState,
    explorer,
    handleRefresh,
    isRefreshing,
    linkedContainerIds: selectedNoteLinkedContainerIds,
    mergeNoteSummary,
    modalState,
    openInlineNote,
    peerUserId,
    refreshError,
    selection,
    unlinkNote,
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
        canActivateSelectedNote={model.canActivateSelectedNote}
        canLinkSelectedNote={model.canLinkSelectedNote}
        canMoveSelectedNote={model.canMoveSelectedNote}
        canUnlinkSelectedNote={model.canUnlinkSelectedNote}
        handleRefresh={model.handleRefresh}
        isRefreshing={model.isRefreshing}
        linkedContainerIds={model.linkedContainerIds}
        mergeNoteSummary={model.mergeNoteSummary}
        nodes={model.explorer.nodes}
        openInlineNote={model.openInlineNote}
        openLinkNoteModal={model.modalState.openLinkNoteModal}
        openMoveNoteModal={model.modalState.openMoveNoteModal}
        ready={model.explorer.ready}
        refreshError={model.refreshError}
        selectedNode={model.selection.selectedNode}
        selectedNote={model.selection.selectedNote}
        setSelectedId={model.selection.setSelectedId}
        unlinkNote={model.unlinkNote}
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
