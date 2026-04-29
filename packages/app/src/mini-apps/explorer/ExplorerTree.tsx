import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
} from "react";
import type { DocumentContainerProjection } from "./documentProjections";
import type { ContainerNode } from "./types";

export interface ExplorerTreeEntry {
  children: ExplorerTreeEntry[];
  node: ContainerNode;
}

export function buildExplorerTree(
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

interface ExplorerTreeEntriesProps {
  activeContainerId: string | null;
  collapsedIds: ReadonlySet<string>;
  depth: number;
  documentsByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentContainerProjection>
  >;
  entries: ReadonlyArray<ExplorerTreeEntry>;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>, id: string) => void;
  onSelectContainer: (id: string) => void;
  onSelectDocument: (documentId: string, containerId: string) => void;
  onToggleCollapsed: (id: string) => void;
  selectedId: string | null;
}

function ExplorerTreeEntries(props: ExplorerTreeEntriesProps): ReactNode {
  return props.entries.map((entry) => (
    <ExplorerTreeEntryNode key={entry.node.id} {...props} entry={entry} />
  ));
}

function ExplorerTreeEntryNode(
  props: Omit<ExplorerTreeEntriesProps, "entries"> & {
    entry: ExplorerTreeEntry;
  },
) {
  const {
    activeContainerId,
    collapsedIds,
    depth,
    documentsByContainerId,
    entry,
    onContextMenu,
    onSelectContainer,
    onSelectDocument,
    onToggleCollapsed,
    selectedId,
  } = props;
  const hasChildren = entry.children.length > 0;
  const isCollapsed = collapsedIds.has(entry.node.id);

  return (
    <Fragment>
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
            aria-label={isCollapsed ? "Expand container" : "Collapse container"}
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
      {!isCollapsed && (
        <ExplorerTreeEntries
          {...props}
          depth={depth + 1}
          entries={entry.children}
        />
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
                    (selectedId === localId && activeContainerId === containerId
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
}

export function useExplorerSidebarPanel(params: {
  activeContainerId: string | null;
  collapsedIds: ReadonlySet<string>;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
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
          <ExplorerTreeEntries
            activeContainerId={activeContainerId}
            collapsedIds={collapsedIds}
            depth={0}
            documentsByContainerId={documentsByContainerId}
            entries={treeEntries}
            onContextMenu={handleSidebarContextMenu}
            onSelectContainer={setSelectedId}
            onSelectDocument={selectDocumentProjection}
            onToggleCollapsed={toggleCollapsed}
            selectedId={selectedId}
          />
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
