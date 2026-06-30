import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import type { ContainerDocumentSidebarRow } from "@tearleads/client-sdk";
import type { MouseEvent } from "react";
import {
  MiniAppRow,
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import { MiniAppVirtualBlockSpacer } from "../../components/shared/MiniAppVirtual";
import { getViewerRelativeContactDocumentLabel } from "../../stores/contacts/contactLabels";
import {
  type ExplorerSidebarDocumentWindowState,
  type ExplorerSidebarVirtualRow,
  getLoadedExplorerSidebarDocumentRow,
} from "./ExplorerSidebarRows";
import {
  EXPLORER_SIDEBAR_ROW_HEIGHT,
  type ExplorerTreeEntry,
} from "./explorerTreeModel";

export interface ExplorerSidebarRowProps {
  activeContainerId: string | null;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  depth: number;
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  onContextMenu: (event: MouseEvent<HTMLElement>, id: string) => void;
  onDocumentContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    localId: string,
    containerId: string,
  ) => void;
  onSelectContainer: (id: string) => void;
  onSelectDocument: (documentId: string, containerId: string) => void;
  onRetryDocumentWindow: (containerId: string, offset: number) => void;
  onToggleCollapsed: (id: string) => void;
  selectedId: string | null;
}

function getExplorerSidebarRowStyle(depth: number): {
  paddingLeft: string;
} {
  return {
    paddingLeft: `calc(var(--padding) / 2 + (var(--padding) * ${depth}))`,
  };
}

function getExplorerFolderIcon(params: {
  icon: string | null | undefined;
  isOpen: boolean;
}) {
  const iconName = params.isOpen ? "folder-open" : "folder";

  return {
    Component: params.isOpen ? FolderOpenIcon : FolderIcon,
    containerIcon: params.icon?.trim() || "folder",
    name: iconName,
  };
}

function ExplorerTreeDocumentRow(
  props: Omit<
    ExplorerSidebarRowProps,
    "onContextMenu" | "onToggleCollapsed"
  > & {
    row: ContainerDocumentSidebarRow;
  },
) {
  const { row } = props;
  const title = getViewerRelativeContactDocumentLabel({
    currentSigningFingerprint: props.currentSigningFingerprint,
    currentUserId: props.currentUserId,
    documentKind: row.documentKind,
    fallbackLabel: row.title,
    localId: row.localId,
  });

  return (
    <div
      className="explorer-sidebar-row"
      style={getExplorerSidebarRowStyle(props.depth)}
    >
      <span className="explorer-node-spacer" aria-hidden="true" />
      <MiniAppRowButton
        data-document-local-id={row.localId}
        className="explorer-sidebar-item explorer-sidebar-item--note"
        onClick={() => props.onSelectDocument(row.localId, row.containerId)}
        onContextMenu={(event) =>
          props.onDocumentContextMenu(event, row.localId, row.containerId)
        }
        selected={
          props.selectedId === row.localId &&
          props.activeContainerId === row.containerId
        }
      >
        <MiniAppRowText>{title}</MiniAppRowText>
      </MiniAppRowButton>
    </div>
  );
}

function ExplorerTreeDocumentPlaceholderRow(
  props: Pick<ExplorerSidebarRowProps, "depth" | "onRetryDocumentWindow"> & {
    containerId: string;
    error: string | null;
    isLoading: boolean;
    offset: number;
  },
) {
  const {
    containerId,
    depth,
    error,
    isLoading,
    offset,
    onRetryDocumentWindow,
  } = props;
  const label = error ? "Retry" : "Loading...";

  return (
    <div
      className="explorer-sidebar-row"
      style={getExplorerSidebarRowStyle(depth)}
    >
      <span className="explorer-node-spacer" aria-hidden="true" />
      <MiniAppRowButton
        className="explorer-sidebar-item explorer-sidebar-item--more"
        disabled={!error || isLoading}
        onClick={() => onRetryDocumentWindow(containerId, offset)}
      >
        <MiniAppRowText>{label}</MiniAppRowText>
      </MiniAppRowButton>
    </div>
  );
}

function ExplorerTreeContainerRow(
  props: Omit<ExplorerSidebarRowProps, "onDocumentContextMenu"> & {
    entry: ExplorerTreeEntry;
    isCollapsed: boolean;
  },
) {
  const {
    depth,
    entry,
    isCollapsed,
    onContextMenu,
    onSelectContainer,
    onToggleCollapsed,
    selectedId,
  } = props;
  const hasChildren = entry.children.length > 0;
  const isSelected = selectedId === entry.node.id;
  const isOpen =
    !isCollapsed &&
    (isSelected || props.activeContainerId === entry.node.id || hasChildren);
  const folderIcon = getExplorerFolderIcon({
    icon: entry.node.icon,
    isOpen,
  });
  const FolderGlyph = folderIcon.Component;

  return (
    <div
      className="explorer-sidebar-row"
      style={getExplorerSidebarRowStyle(depth)}
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
            {"▶"}
          </span>
        </button>
      ) : (
        <span className="explorer-node-spacer" aria-hidden="true" />
      )}
      <MiniAppRowButton
        className="explorer-sidebar-item"
        onClick={() => onSelectContainer(entry.node.id)}
        onContextMenu={(event) => onContextMenu(event, entry.node.id)}
        selected={isSelected}
      >
        <FolderGlyph
          aria-hidden="true"
          className="explorer-folder-icon"
          data-container-icon={folderIcon.containerIcon}
          data-icon={folderIcon.name}
          focusable="false"
          size={16}
          weight="regular"
        />
        <MiniAppRowText>{entry.node.name}</MiniAppRowText>
      </MiniAppRowButton>
    </div>
  );
}

function ExplorerSidebarSectionLabelRow(props: { label: string }) {
  return (
    <div className="explorer-sidebar-row explorer-sidebar-row--section">
      <MiniAppRow
        className="explorer-sidebar-section-label"
        header
        role="heading"
        aria-level={2}
      >
        <MiniAppRowText truncate={false}>{props.label}</MiniAppRowText>
      </MiniAppRow>
    </div>
  );
}

function ExplorerSidebarVirtualRowView(
  props: ExplorerSidebarRowProps & {
    row: ExplorerSidebarVirtualRow;
  },
) {
  const { row } = props;

  if (row.kind === "section-label") {
    return <ExplorerSidebarSectionLabelRow label={row.label} />;
  }

  if (row.kind === "container") {
    return (
      <ExplorerTreeContainerRow
        {...props}
        depth={row.depth}
        entry={row.entry}
        isCollapsed={row.isCollapsed}
      />
    );
  }

  if (row.kind === "document-status") {
    return (
      <ExplorerTreeDocumentPlaceholderRow
        containerId={row.containerId}
        depth={row.depth}
        error={row.error}
        isLoading={row.isLoading}
        offset={0}
        onRetryDocumentWindow={props.onRetryDocumentWindow}
      />
    );
  }

  const documentRow = getLoadedExplorerSidebarDocumentRow(row);
  if (documentRow) {
    return (
      <ExplorerTreeDocumentRow {...props} depth={row.depth} row={documentRow} />
    );
  }

  return (
    <ExplorerTreeDocumentPlaceholderRow
      containerId={row.containerId}
      depth={row.depth}
      error={row.state.error}
      isLoading={row.state.isLoading}
      offset={row.documentIndex}
      onRetryDocumentWindow={props.onRetryDocumentWindow}
    />
  );
}

export function ExplorerSidebarVirtualTree(
  props: ExplorerSidebarRowProps & {
    offset: number;
    rows: ReadonlyArray<ExplorerSidebarVirtualRow>;
    totalRows: number;
  },
) {
  const topPadding = props.offset * EXPLORER_SIDEBAR_ROW_HEIGHT;
  const bottomPadding =
    Math.max(0, props.totalRows - props.offset - props.rows.length) *
    EXPLORER_SIDEBAR_ROW_HEIGHT;

  return (
    <div className="explorer-sidebar-virtual-space">
      {topPadding > 0 ? (
        <MiniAppVirtualBlockSpacer height={topPadding} />
      ) : null}
      {props.rows.map((row) => (
        <ExplorerSidebarVirtualRowView key={row.key} {...props} row={row} />
      ))}
      {bottomPadding > 0 ? (
        <MiniAppVirtualBlockSpacer height={bottomPadding} />
      ) : null}
    </div>
  );
}
