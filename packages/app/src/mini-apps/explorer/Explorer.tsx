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
import { primeNotesStore } from "../notes/NotesProvider";
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
  | { mode: "move"; nodeId: string }
  | { mode: "move-note"; noteId: string }
  | { mode: "rename"; nodeId: string }
  | { mode: "share-peer"; nodeId: string };

interface MoveTargetOption {
  id: string;
  label: string;
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

function getMovedNoteContainerId(
  document: ContainerDocumentSummary,
  preferredContainerId: string,
): string | null {
  if (document.linkedContainerIds.includes(preferredContainerId)) {
    return preferredContainerId;
  }

  return document.linkedContainerIds[0] ?? null;
}

async function buildFallbackMovedNoteSummary(params: {
  accessEpoch: number;
  containerId: string;
  documentId: string;
  execSql: ReturnType<typeof useAppData>["execSql"];
  note: NoteSummary;
}): Promise<NoteSummary> {
  const { accessEpoch, containerId, documentId, execSql, note } = params;

  await sqlNotesPersistence.saveNote(execSql, {
    accessEpoch,
    containerId,
    documentId,
    documentRecipientEnvelopes: null,
    id: note.id,
    loroSnapshot: "",
    text: note.title === "Untitled note" ? "" : note.title,
  });

  return {
    ...note,
    containerId,
    documentId,
    updatedAt: new Date().toISOString(),
  };
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

  const unlinkedDocument = await appData.apiClient.unlinkDocumentFromContainer(
    note.documentId,
    note.containerId,
  );
  if (!unlinkedDocument) {
    appData.log(
      `Explorer: failed to unlink note ${note.id} from container ${note.containerId}`,
    );
    return null;
  }

  await appData.cacheReferencedPrincipalPolicies([
    ...(linkedDocument.referencedPrincipals ?? []),
    ...(unlinkedDocument.referencedPrincipals ?? []),
  ]);

  await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
    appData.execSql,
    note.documentId,
    unlinkedDocument.linkedContainerIds,
  );

  const nextContainerId = getMovedNoteContainerId(
    unlinkedDocument,
    targetContainerId,
  );
  if (!nextContainerId) {
    return null;
  }

  return {
    currentAccessEpoch: unlinkedDocument.currentAccessEpoch,
    nextContainerId,
  };
}

function renderTreeEntries(
  entries: ReadonlyArray<ExplorerTreeEntry>,
  depth: number,
  activeContainerId: string | null,
  collapsedIds: ReadonlySet<string>,
  notesByContainerId: ReadonlyMap<string, ReadonlyArray<NoteSummary>>,
  selectedId: string | null,
  onSelectContainer: (id: string) => void,
  onSelectNote: (id: string) => void,
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
        {!isCollapsed && entry.node.id === activeContainerId
          ? (notesByContainerId.get(entry.node.id) ?? []).map(
              ({ id, title }) => (
                <div
                  className="explorer-sidebar-row"
                  key={id}
                  style={{
                    paddingLeft: `calc(var(--padding) / 2 + (var(--padding) * ${depth + 1}))`,
                  }}
                >
                  <span className="explorer-node-spacer" aria-hidden="true" />
                  <button
                    type="button"
                    data-note-id={id}
                    className={
                      "explorer-sidebar-item explorer-sidebar-item--note" +
                      (selectedId === id
                        ? " explorer-sidebar-item--selected"
                        : "")
                    }
                    onClick={() => onSelectNote(id)}
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

function buildNotesByContainerId(
  noteSummaries: ReadonlyArray<NoteSummary>,
): ReadonlyMap<string, ReadonlyArray<NoteSummary>> {
  const nextNotesByContainerId = new Map<string, NoteSummary[]>();

  for (const note of noteSummaries) {
    if (!note.containerId) {
      continue;
    }

    const existingNotes = nextNotesByContainerId.get(note.containerId) ?? [];
    existingNotes.push(note);
    nextNotesByContainerId.set(note.containerId, existingNotes);
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
      commitDocumentChange: (
        documentId: string,
        input: Parameters<typeof apiClient.commitDocumentChange>[1],
      ) => apiClient.commitDocumentChange(documentId, input),
      createDocument: (linkedContainerIds: string[]) =>
        apiClient.createDocument(linkedContainerIds),
      getBlob: (blobId: string) => apiClient.getBlob(blobId),
      listDocumentAttachments: (documentId: string) =>
        apiClient.listDocumentAttachments(documentId),
      stageBlob: (input: Parameters<typeof apiClient.stageBlob>[0]) =>
        apiClient.stageBlob(input),
      syncDocument: (
        documentId: string,
        accessEpoch: number,
        localVersionVector: string | null,
        outgoingUpdates: Parameters<typeof apiClient.syncDocument>[3],
        documentRecipientEnvelopes?: Parameters<
          typeof apiClient.syncDocument
        >[4],
      ) =>
        apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
          documentRecipientEnvelopes,
        ),
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

  return { mergeNoteSummaries, mergeNoteSummary, noteSummaries };
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
            replaceDocumentLinksBatch: (inputs) =>
              sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
                execSql,
                inputs,
              ),
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
  refresh: () => Promise<boolean>;
}) {
  const {
    apiClient,
    cacheReferencedPrincipalPolicies,
    execSql,
    mergeNoteSummaries,
    primeDiscoveredNotes,
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
        replaceDocumentLinksBatch: (inputs) =>
          sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
            execSql,
            inputs,
          ),
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
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
}) {
  const {
    nodes,
    noteSummaries,
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

  return {
    openMoveModal,
    openMoveNoteModal,
  };
}

function useExplorerModalOpeners(params: {
  nodes: ReadonlyArray<ContainerNode>;
  noteSummaries: ReadonlyArray<NoteSummary>;
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
  modalState: { mode: "move-note"; noteId: string };
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

  const movedNote = await moveNote(modalState.noteId, targetContainerId);
  if (!movedNote) {
    setModalError("Failed to move note.");
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
    | { mode: "move"; nodeId: string }
    | { mode: "move-note"; noteId: string }
    | { mode: "share-peer"; nodeId: string };
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
    case "move-note":
      await submitExplorerMoveNoteModal({
        clearModal: params.clearModal,
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
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const modalState = useExplorerModalState(params.nodes, params.noteSummaries);
  const moveTargetOptions =
    modalState.modalState?.mode === "move"
      ? getMoveTargetOptions(params.nodes, modalState.modalState.nodeId)
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
  notesByContainerId: ReadonlyMap<string, ReadonlyArray<NoteSummary>>;
  ready: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setSidebar: (sidebar: ReactNode | null) => void;
  toggleCollapsed: (nodeId: string) => void;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
  nodes: ReadonlyArray<ContainerNode>;
}) {
  const {
    activeContainerId,
    collapsedIds,
    handleSidebarContextMenu,
    notesByContainerId,
    ready,
    selectedId,
    setSelectedId,
    setSidebar,
    toggleCollapsed,
    treeEntries,
    nodes,
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
            setSelectedId,
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
  targetContainerId: string;
}) {
  const { appData, expandNode, mergeNoteSummary, note, targetContainerId } =
    params;
  if (
    !note.documentId ||
    !note.containerId ||
    note.containerId === targetContainerId
  ) {
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
  const { currentAccessEpoch, nextContainerId } = movedDocument;

  const movedNote =
    (await sqlNotesPersistence.relinkPersistedNote(appData.execSql, {
      accessEpoch: currentAccessEpoch,
      containerId: nextContainerId,
      documentId: note.documentId,
      noteId: note.id,
    })) ??
    (await buildFallbackMovedNoteSummary({
      accessEpoch: currentAccessEpoch,
      containerId: nextContainerId,
      documentId: note.documentId,
      execSql: appData.execSql,
      note,
    }));

  if (!movedNote) {
    appData.log(`Explorer: failed to persist moved note ${note.id}`);
    return null;
  }

  mergeNoteSummary(movedNote);
  expandNode(nextContainerId);
  primeNotesStore(
    appData.domainScope,
    movedNote.id,
    createNotesRuntimeFromExplorer(
      appData.apiClient,
      appData.blobStore,
      appData.cacheReferencedPrincipalPolicies,
      nextContainerId,
      appData.dbStatus,
      appData.domainScope,
      appData.encapsulationKeyPair,
      appData.execSql,
      appData.isAuthenticated,
      appData.log,
      appData.online,
    ),
    mergeNoteSummary,
    movedNote.documentId,
  ).requestSync();
  appData.log(`Explorer: moved note ${movedNote.id} to ${nextContainerId}`);
  return movedNote;
}

function useMoveNoteAction(params: {
  appData: ReturnType<typeof useAppData>;
  expandNode: (nodeId: string) => void;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  noteSummaries: ReadonlyArray<NoteSummary>;
}) {
  const { appData, expandNode, mergeNoteSummary, noteSummaries } = params;

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

      return moveExplorerNote({
        appData,
        expandNode,
        mergeNoteSummary,
        note: existingNote,
        targetContainerId,
      });
    },
    [appData, expandNode, mergeNoteSummary, noteSummaries],
  );
}

function ExplorerNoteDetail(params: {
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  canMoveSelectedNote: boolean;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  openMoveNoteModal: (noteId: string) => void;
  ready: boolean;
  refreshError: string | null;
  selectedNote: NoteSummary;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    canMoveSelectedNote,
    handleRefresh,
    isRefreshing,
    mergeNoteSummary,
    nodes,
    openMoveNoteModal,
    ready,
    refreshError,
    selectedNote,
    setSelectedId,
  } = params;
  const selectedNoteContainer = selectedNote?.containerId
    ? nodes.find((node) => node.id === selectedNote.containerId)
    : null;

  return (
    <div
      className="explorer-detail explorer-detail--note"
      key={selectedNote.id}
    >
      <div className="explorer-detail-header">
        <div className="explorer-detail-copy">
          <strong>{selectedNote.title}</strong>
          <span>
            note
            {selectedNoteContainer ? ` in ${selectedNoteContainer.name}` : ""}
          </span>
        </div>
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
      </div>
      {refreshError ? (
        <span className="explorer-detail-error">{refreshError}</span>
      ) : null}
      <div className="explorer-inline-note">
        <NotesApp
          noteId={selectedNote.id}
          {...(selectedNote.containerId === undefined
            ? {}
            : { containerId: selectedNote.containerId })}
          {...(selectedNote.documentId === undefined
            ? {}
            : { documentId: selectedNote.documentId })}
          onPersistedNote={mergeNoteSummary}
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
  canMoveSelectedNote: boolean;
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  openInlineNote: (containerId: string, noteId?: string) => void;
  openMoveNoteModal: (noteId: string) => void;
  ready: boolean;
  refreshError: string | null;
  selectedNode: ContainerNode | undefined;
  selectedNote: NoteSummary | undefined;
  setSelectedId: (id: string | null) => void;
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
    modalState.mode !== "move" &&
    modalState.mode !== "move-note" &&
    modalState.mode !== "share-peer";
  if (nameIsRequired && draftName.trim().length === 0) {
    return true;
  }

  if (
    (modalState.mode === "move" || modalState.mode === "move-note") &&
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

  if (modalState.mode === "move" || modalState.mode === "move-note") {
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
) {
  const { mergeNoteSummaries, mergeNoteSummary, noteSummaries } =
    useExplorerNoteSummaryState(
      appData.dbStatus,
      appData.domainScope,
      appData.execSql,
      explorer.nodes,
    );
  const notesByContainerId = useMemo(
    () => buildNotesByContainerId(noteSummaries),
    [noteSummaries],
  );
  const knownDocumentIds = useMemo(
    () => getKnownDocumentIds(noteSummaries),
    [noteSummaries],
  );
  const selection = useExplorerSelection(explorer.nodes, noteSummaries);

  return {
    knownDocumentIds,
    mergeNoteSummaries,
    mergeNoteSummary,
    noteSummaries,
    notesByContainerId,
    selection,
  };
}

function useExplorerInteractionState(params: {
  activeContainerId: string | null;
  appData: ReturnType<typeof useAppData>;
  explorer: ReturnType<typeof useExplorer>;
  knownDocumentIds: ReadonlySet<string>;
  mergeNoteSummaries: (nextNotes: ReadonlyArray<NoteSummary>) => void;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
}) {
  const {
    activeContainerId,
    appData,
    explorer,
    knownDocumentIds,
    mergeNoteSummaries,
    mergeNoteSummary,
  } = params;
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
  });

  return useExplorerRefreshAction({
    apiClient: appData.apiClient,
    cacheReferencedPrincipalPolicies: appData.cacheReferencedPrincipalPolicies,
    execSql: appData.execSql,
    mergeNoteSummaries,
    primeDiscoveredNotes,
    refresh: explorer.refresh,
  });
}

function useExplorerPanelState(params: {
  appData: ReturnType<typeof useAppData>;
  explorer: ReturnType<typeof useExplorer>;
  mergeNoteSummary: (nextNote: NoteSummary) => void;
  noteSummaries: ReadonlyArray<NoteSummary>;
  notesByContainerId: ReadonlyMap<string, ReadonlyArray<NoteSummary>>;
  peerUserId: string | null;
  selection: ReturnType<typeof useExplorerSelection>;
  setSidebar: (sidebar: ReactNode | null) => void;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}) {
  const {
    appData,
    explorer,
    mergeNoteSummary,
    noteSummaries,
    notesByContainerId,
    peerUserId,
    selection,
    setSidebar,
    treeEntries,
  } = params;
  const contextMenuState = useExplorerContextMenu(
    explorer.nodes,
    selection.setSelectedId,
  );
  const moveNote = useMoveNoteAction({
    appData,
    expandNode: selection.expandNode,
    mergeNoteSummary,
    noteSummaries,
  });
  useExplorerSidebarPanel({
    activeContainerId: selection.activeContainerId,
    collapsedIds: selection.collapsedIds,
    handleSidebarContextMenu: contextMenuState.handleSidebarContextMenu,
    notesByContainerId,
    nodes: explorer.nodes,
    ready: explorer.ready,
    selectedId: selection.selectedId,
    setSelectedId: selection.setSelectedId,
    setSidebar,
    toggleCollapsed: selection.toggleCollapsed,
    treeEntries,
  });
  const modalState = useExplorerModalController({
    createChild: explorer.createChild,
    deleteContainer: explorer.deleteContainer,
    expandNode: selection.expandNode,
    moveContainer: explorer.moveContainer,
    moveNote,
    nodes: explorer.nodes,
    noteSummaries,
    peerUserId,
    renameContainer: explorer.renameContainer,
    setSelectedId: selection.setSelectedId,
    shareWithUser: explorer.shareWithUser,
  });
  const openInlineNote = useInlineNoteAction({
    expandNode: selection.expandNode,
    mergeNoteSummary,
    setSelectedId: selection.setSelectedId,
  });
  const selectedNoteMoveTargetOptions = selection.selectedNote
    ? getNoteMoveTargetOptions(
        explorer.nodes,
        noteSummaries,
        selection.selectedNote.id,
      )
    : [];

  return {
    contextMenuState,
    modalState,
    openInlineNote,
    selectedNoteMoveTargetOptions,
  };
}

function useExplorerModel(
  appData: ReturnType<typeof useAppData>,
  explorer: ReturnType<typeof useExplorer>,
  setSidebar: (sidebar: ReactNode | null) => void,
  peerUserId: string | null,
) {
  const {
    knownDocumentIds,
    mergeNoteSummaries,
    mergeNoteSummary,
    noteSummaries,
    notesByContainerId,
    selection,
  } = useExplorerNoteViewModel(appData, explorer);
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
    });
  const {
    contextMenuState,
    modalState,
    openInlineNote,
    selectedNoteMoveTargetOptions,
  } = useExplorerPanelState({
    appData,
    explorer,
    mergeNoteSummary,
    noteSummaries,
    notesByContainerId,
    peerUserId,
    selection,
    setSidebar,
    treeEntries,
  });

  return {
    canMoveSelectedNote:
      appData.dbStatus === "ready" &&
      appData.isAuthenticated &&
      appData.online &&
      !!selection.selectedNote?.documentId &&
      selectedNoteMoveTargetOptions.length > 0,
    contextMenuState,
    explorer,
    handleRefresh,
    isRefreshing,
    mergeNoteSummary,
    modalState,
    openInlineNote,
    peerUserId,
    refreshError,
    selection,
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
        canMoveSelectedNote={model.canMoveSelectedNote}
        handleRefresh={model.handleRefresh}
        isRefreshing={model.isRefreshing}
        mergeNoteSummary={model.mergeNoteSummary}
        nodes={model.explorer.nodes}
        openInlineNote={model.openInlineNote}
        openMoveNoteModal={model.modalState.openMoveNoteModal}
        ready={model.explorer.ready}
        refreshError={model.refreshError}
        selectedNode={model.selection.selectedNode}
        selectedNote={model.selection.selectedNote}
        setSelectedId={model.selection.setSelectedId}
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
