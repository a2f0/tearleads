import {
  type CSSProperties,
  type FormEvent,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Menu, type MenuPosition } from "../../components/shared/Menu";
import { MenuItem } from "../../components/shared/MenuItem";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useExplorer } from "./ExplorerProvider";
import type { ContainerNode } from "./types";
import "./Explorer.css";

interface ExplorerTreeEntry {
  children: ExplorerTreeEntry[];
  node: ContainerNode;
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
  selectedId: string | null,
  onSelect: (id: string) => void,
  onContextMenu: (
    event: React.MouseEvent<HTMLButtonElement>,
    id: string,
  ) => void,
  renderNodeLabel: (name: string) => ReactNode,
): ReactNode {
  return entries.map((entry) => (
    <Fragment key={entry.node.id}>
      <button
        type="button"
        className={
          "explorer-sidebar-item" +
          (selectedId === entry.node.id
            ? " explorer-sidebar-item--selected"
            : "")
        }
        style={{ "--explorer-depth": depth } as CSSProperties}
        onClick={() => onSelect(entry.node.id)}
        onContextMenu={(event) => onContextMenu(event, entry.node.id)}
      >
        {renderNodeLabel(entry.node.name)}
      </button>
      {renderTreeEntries(
        entry.children,
        depth + 1,
        selectedId,
        onSelect,
        onContextMenu,
        renderNodeLabel,
      )}
    </Fragment>
  ));
}

export function Explorer() {
  const { createChild, nodes, ready } = useExplorer();
  const { setSidebar } = useWindowSidebar();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    position: MenuPosition;
  } | null>(null);
  const [createChildParentId, setCreateChildParentId] = useState<string | null>(
    null,
  );
  const [createChildError, setCreateChildError] = useState<string | null>(null);
  const [isCreatingChild, setIsCreatingChild] = useState(false);
  const [draftChildName, setDraftChildName] = useState("");
  const childNameInputRef = useRef<HTMLInputElement>(null);

  const renderNodeLabel = useCallback((name: string) => {
    return (
      <>
        <span className="explorer-node-icon">{"\u25B6"}</span>
        {name}
      </>
    );
  }, []);

  const treeEntries = useMemo(() => buildExplorerTree(nodes), [nodes]);

  useEffect(() => {
    if (nodes.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !nodes.some((node) => node.id === selectedId)) {
      setSelectedId(nodes[0]?.id ?? null);
    }
  }, [nodes, selectedId]);

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
            selectedId,
            setSelectedId,
            handleSidebarContextMenu,
            renderNodeLabel,
          )
        )}
      </div>
    );
  }, [
    handleSidebarContextMenu,
    nodes.length,
    ready,
    renderNodeLabel,
    selectedId,
    treeEntries,
  ]);

  useEffect(() => {
    setSidebar(sidebar);
    return () => setSidebar(null);
  }, [setSidebar, sidebar]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const closeCreateChildModal = useCallback(() => {
    if (isCreatingChild) {
      return;
    }

    setCreateChildParentId(null);
    setCreateChildError(null);
    setDraftChildName("");
  }, [isCreatingChild]);

  const openCreateChildModal = useCallback((parentId: string) => {
    setCreateChildParentId(parentId);
    setCreateChildError(null);
    setDraftChildName("");
  }, []);

  useEffect(() => {
    if (!createChildParentId) {
      return;
    }

    childNameInputRef.current?.focus();
    childNameInputRef.current?.select();
  }, [createChildParentId]);

  useEffect(() => {
    if (!createChildParentId) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isCreatingChild) {
        event.preventDefault();
        closeCreateChildModal();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [createChildParentId, closeCreateChildModal, isCreatingChild]);

  const handleCreateChild = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!createChildParentId || isCreatingChild) {
        return;
      }

      setCreateChildError(null);
      setIsCreatingChild(true);

      try {
        const nextNode = await createChild(createChildParentId, draftChildName);
        if (!nextNode) {
          setCreateChildError("Failed to create child container.");
          return;
        }

        setSelectedId(nextNode.id);
        setCreateChildParentId(null);
        setCreateChildError(null);
        setDraftChildName("");
      } catch (error: unknown) {
        console.error("Failed to create child container:", error);
        setCreateChildError("Failed to create child container.");
      } finally {
        setIsCreatingChild(false);
      }
    },
    [createChild, createChildParentId, draftChildName, isCreatingChild],
  );

  const selectedNode = nodes.find((node) => node.id === selectedId);

  return (
    <div className="explorer">
      {selectedNode ? (
        <div className="explorer-detail" key={selectedNode.id}>
          <div className="explorer-detail-copy">
            <strong>{selectedNode.name}</strong>
            <span>{selectedNode.kind}</span>
          </div>
          <span>ID: {selectedNode.id}</span>
          <span>Parent: {selectedNode.parentId ?? "(root)"}</span>
          <span>Organization: {selectedNode.organizationId || "(local)"}</span>
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
        </Menu>
      )}
      {createChildParentId && (
        <div className="explorer-modal-backdrop" role="presentation">
          <div
            className="explorer-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="explorer-create-child-title"
          >
            <form className="explorer-modal-form" onSubmit={handleCreateChild}>
              <h2 id="explorer-create-child-title">Create Child</h2>
              <label className="explorer-modal-field">
                Name
                <input
                  ref={childNameInputRef}
                  aria-label="Container name"
                  disabled={isCreatingChild}
                  value={draftChildName}
                  onChange={(event) => {
                    setCreateChildError(null);
                    setDraftChildName(event.target.value);
                  }}
                />
              </label>
              {createChildError && (
                <div className="explorer-modal-error">{createChildError}</div>
              )}
              <div className="explorer-modal-actions">
                <button
                  type="button"
                  disabled={isCreatingChild}
                  onClick={closeCreateChildModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isCreatingChild || draftChildName.trim().length === 0
                  }
                >
                  {isCreatingChild ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
