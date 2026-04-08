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
  | { mode: "rename"; nodeId: string }
  | { mode: "share-peer"; nodeId: string };

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

export function Explorer() {
  const {
    apiClient,
    blobStore,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    events,
    execSql,
    isAuthenticated,
    log,
    online,
  } = useAppData();
  const {
    createChild,
    deleteContainer,
    nodes,
    refresh,
    ready,
    renameContainer,
    shareWithUser,
  } = useExplorer();
  const { setSidebar } = useWindowSidebar();
  const peerUserId = usePeerUserId();
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    position: MenuPosition;
  } | null>(null);
  const [modalState, setModalState] = useState<ExplorerModalState | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [noteSummaries, setNoteSummaries] = useState<
    ReadonlyArray<NoteSummary>
  >([]);
  const [draftName, setDraftName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  const treeEntries = useMemo(() => buildExplorerTree(nodes), [nodes]);
  const notesByContainerId = useMemo(() => {
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
      notes.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    }

    return nextNotesByContainerId;
  }, [noteSummaries]);
  const knownDocumentIds = useMemo(
    () =>
      new Set(
        noteSummaries.flatMap((note) =>
          note.documentId ? [note.documentId] : [],
        ),
      ),
    [noteSummaries],
  );

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
    setNoteSummaries((currentNoteSummaries) => {
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
    });
  }, []);

  const mergeNoteSummaries = useCallback(
    (nextNotes: ReadonlyArray<NoteSummary>) => {
      if (nextNotes.length === 0) {
        return;
      }

      setNoteSummaries((currentNoteSummaries) => {
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
          if (!existingNote) {
            continue;
          }

          if (
            existingNote.title === nextNote.title &&
            existingNote.containerId === nextNote.containerId &&
            existingNote.documentId === nextNote.documentId
          ) {
            continue;
          }

          nextNoteSummaries[existingNoteIndex] = nextNote;
          changed = true;
        }

        return changed ? nextNoteSummaries : currentNoteSummaries;
      });
    },
    [],
  );

  const selectedNode = nodes.find((node) => node.id === selectedId);
  const selectedNote = noteSummaries.find((note) => note.id === selectedId);
  const activeContainerId =
    selectedNote?.containerId ?? selectedNode?.id ?? null;
  const primeDiscoveredNotes = useCallback(
    (discoveredNoteSummaries: ReadonlyArray<NoteSummary>) => {
      for (const noteSummary of discoveredNoteSummaries) {
        if (!noteSummary.containerId) {
          continue;
        }

        const notesStore = primeNotesStore(
          domainScope,
          noteSummary.id,
          {
            apiClient,
            blobStore,
            containerId: noteSummary.containerId,
            dbStatus,
            domainScope,
            encapsulationKeyPair,
            events: [],
            execSql,
            isAuthenticated,
            log,
            online,
          },
          mergeNoteSummary,
          noteSummary.documentId,
        );
        notesStore.requestSync();
      }
    },
    [
      apiClient,
      blobStore,
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
  const discoverDocumentsForContainer = useCallback(
    (containerId: string) => {
      let cancelled = false;

      void (async () => {
        try {
          const discoveredNoteSummaries = await discoverContainerDocuments({
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
          if (isDestroyedDatabaseWorkerError(error)) {
            return;
          }

          throw error;
        }
      })();

      return () => {
        cancelled = true;
      };
    },
    [apiClient, dbStatus, mergeNoteSummaries, primeDiscoveredNotes],
  );

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
    [],
  );

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
      if (isDestroyedDatabaseWorkerError(error)) {
        return;
      }

      console.error("Failed to refresh explorer:", error);
      setRefreshError("Failed to refresh explorer.");
    } finally {
      setIsRefreshing(false);
    }
  }, [
    apiClient.listContainerDocuments,
    apiClient.listContainers,
    execSql,
    mergeNoteSummaries,
    primeDiscoveredNotes,
    refresh,
  ]);

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

  const sidebar = useMemo(() => {
    return (
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
    );
  }, [
    collapsedIds,
    toggleCollapsed,
    handleSidebarContextMenu,
    noteSummaries,
    notesByContainerId,
    nodes.length,
    ready,
    selectedId,
    treeEntries,
  ]);

  useEffect(() => {
    setSidebar(sidebar);
    return () => setSidebar(null);
  }, [setSidebar, sidebar]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const closeModal = useCallback(() => {
    if (isSubmittingModal) {
      return;
    }

    setModalState(null);
    setModalError(null);
    setDraftName("");
  }, [isSubmittingModal]);

  const openCreateChildModal = useCallback((parentId: string) => {
    setModalState({ mode: "create-child", nodeId: parentId });
    setModalError(null);
    setDraftName("");
  }, []);

  const openRenameModal = useCallback(
    (containerId: string) => {
      const container = nodes.find((node) => node.id === containerId);
      if (!container) {
        return;
      }

      setModalState({ mode: "rename", nodeId: containerId });
      setModalError(null);
      setDraftName(container.name);
    },
    [nodes],
  );

  const openDeleteModal = useCallback((containerId: string) => {
    setModalState({ mode: "delete", nodeId: containerId });
    setModalError(null);
    setDraftName("");
  }, []);

  const openSharePeerModal = useCallback((containerId: string) => {
    setModalState({ mode: "share-peer", nodeId: containerId });
    setModalError(null);
    setDraftName("");
  }, []);

  const openInlineNote = useCallback(
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
    [expandNode, mergeNoteSummary],
  );

  useEffect(() => {
    if (
      !modalState ||
      modalState.mode === "delete" ||
      modalState.mode === "share-peer"
    ) {
      return;
    }

    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [modalState]);

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
  }, [modalState, closeModal, isSubmittingModal]);

  const handleModalSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!modalState || isSubmittingModal) {
        return;
      }

      setModalError(null);
      setIsSubmittingModal(true);

      try {
        if (modalState.mode === "delete") {
          const deletingNode = nodes.find(
            (node) => node.id === modalState.nodeId,
          );
          const deleted = await deleteContainer(modalState.nodeId);
          if (!deleted) {
            setModalError("Failed to delete container.");
            return;
          }

          setSelectedId(deletingNode?.parentId ?? null);
          setModalState(null);
          setModalError(null);
          setDraftName("");
          return;
        }

        if (modalState.mode === "share-peer") {
          if (!peerUserId) {
            setModalError("No peer user is available.");
            return;
          }

          const shared = await shareWithUser(modalState.nodeId, peerUserId);
          if (!shared) {
            setModalError("Failed to share container with peer.");
            return;
          }

          setModalState(null);
          setModalError(null);
          setDraftName("");
          return;
        }

        const nextNode =
          modalState.mode === "create-child"
            ? await createChild(modalState.nodeId, draftName)
            : await renameContainer(modalState.nodeId, draftName);
        if (!nextNode) {
          setModalError(
            modalState.mode === "create-child"
              ? "Failed to create child container."
              : "Failed to rename container.",
          );
          return;
        }

        setSelectedId(nextNode.id);
        if (modalState.mode === "create-child") {
          expandNode(modalState.nodeId);
        }
        setModalState(null);
        setModalError(null);
        setDraftName("");
      } catch (error: unknown) {
        console.error(
          modalState.mode === "create-child"
            ? "Failed to create child container:"
            : modalState.mode === "rename"
              ? "Failed to rename container:"
              : modalState.mode === "delete"
                ? "Failed to delete container:"
                : "Failed to share container with peer:",
          error,
        );
        setModalError(
          modalState.mode === "create-child"
            ? "Failed to create child container."
            : modalState.mode === "rename"
              ? "Failed to rename container."
              : modalState.mode === "delete"
                ? "Failed to delete container."
                : "Failed to share container with peer.",
        );
      } finally {
        setIsSubmittingModal(false);
      }
    },
    [
      createChild,
      deleteContainer,
      draftName,
      expandNode,
      isSubmittingModal,
      modalState,
      nodes,
      peerUserId,
      renameContainer,
      shareWithUser,
    ],
  );

  const selectedNoteContainer = selectedNote?.containerId
    ? nodes.find((node) => node.id === selectedNote.containerId)
    : null;
  const contextMenuNode = nodes.find((node) => node.id === contextMenu?.nodeId);
  const contextMenuNodeHasChildren =
    contextMenuNode !== undefined &&
    nodes.some((node) => node.parentId === contextMenuNode.id);
  const canDeleteContextMenuNode =
    contextMenuNode !== undefined &&
    contextMenuNode.parentId !== null &&
    !contextMenuNodeHasChildren;
  const isDeleteModal = modalState?.mode === "delete";
  const isRenameModal = modalState?.mode === "rename";
  const isSharePeerModal = modalState?.mode === "share-peer";

  return (
    <div className="explorer">
      {selectedNote ? (
        <div
          className="explorer-detail explorer-detail--note"
          key={selectedNote.id}
        >
          <div className="explorer-detail-header">
            <div className="explorer-detail-copy">
              <strong>{selectedNote.title}</strong>
              <span>
                note
                {selectedNoteContainer
                  ? ` in ${selectedNoteContainer.name}`
                  : ""}
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
      ) : selectedNode ? (
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
      ) : (
        <div className="explorer-hint">
          {ready && nodes.length > 0
            ? "Select a container."
            : !ready
              ? "Loading..."
              : "No containers."}
        </div>
      )}
      {contextMenu && (
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
      )}
      {modalState && (
        <div className="explorer-modal-backdrop" role="presentation">
          <div
            className="explorer-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="explorer-modal-title"
          >
            <form className="explorer-modal-form" onSubmit={handleModalSubmit}>
              <h2 id="explorer-modal-title">
                {isDeleteModal
                  ? "Delete Container"
                  : isSharePeerModal
                    ? "Share Container"
                    : isRenameModal
                      ? "Rename Container"
                      : "Create Child"}
              </h2>
              {isDeleteModal ? (
                <div className="explorer-modal-copy">
                  Delete this container?
                </div>
              ) : isSharePeerModal ? (
                <div className="explorer-modal-copy">
                  {peerUserId
                    ? `Share this container with peer user ${peerUserId}?`
                    : "No peer user is available."}
                </div>
              ) : (
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
              )}
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
                  disabled={
                    isSubmittingModal ||
                    (!isDeleteModal &&
                      !isSharePeerModal &&
                      draftName.trim().length === 0) ||
                    (isSharePeerModal && !peerUserId)
                  }
                >
                  {isSubmittingModal
                    ? isDeleteModal
                      ? "Deleting..."
                      : isSharePeerModal
                        ? "Sharing..."
                        : isRenameModal
                          ? "Renaming..."
                          : "Creating..."
                    : isDeleteModal
                      ? "Delete"
                      : isSharePeerModal
                        ? "Share"
                        : isRenameModal
                          ? "Rename"
                          : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
