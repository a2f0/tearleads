import type { MouseEvent } from "react";
import {
  MiniAppRow,
  MiniAppRowButton,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { MiniAppVirtualBlockSpacer } from "../../../components/mini-app/virtual/MiniAppVirtual";
import { useTouchRowHeight } from "../../../navigation/useTouchRowHeight";
import { isExplorerOrphanedDocumentsId } from "../../../stores/explorer/orphanedDocuments";
import { getExplorerContainerIcon } from "../shared/explorerContainerIcons";
import type { ExplorerSidebarVirtualRow } from "./ExplorerSidebarRows";
import {
  EXPLORER_SIDEBAR_ROW_HEIGHT,
  type ExplorerTreeEntry,
} from "./explorerTreeModel";

export interface ExplorerSidebarRowProps {
  activeContainerId: string | null;
  onContextMenu: (event: MouseEvent<HTMLElement>, id: string) => void;
  onSelectContainer: (id: string) => void;
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

function ExplorerTreeContainerRow(
  props: ExplorerSidebarRowProps & {
    depth: number;
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
  const folderIcon = getExplorerContainerIcon({
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
        onContextMenu={(event) => {
          if (isExplorerOrphanedDocumentsId(entry.node.id)) {
            event.preventDefault();
            return;
          }
          onContextMenu(event, entry.node.id);
        }}
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

  return (
    <ExplorerTreeContainerRow
      {...props}
      depth={row.depth}
      entry={row.entry}
      isCollapsed={row.isCollapsed}
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
  // Match the touch-bumped pitch the sidebar window hook uses (via
  // useMiniAppVirtualWindow) so the spacer padding lines the visible rows up
  // with their scroll offset; the CSS row height tracks the same value.
  const rowHeight = useTouchRowHeight(EXPLORER_SIDEBAR_ROW_HEIGHT);
  const topPadding = props.offset * rowHeight;
  const bottomPadding =
    Math.max(0, props.totalRows - props.offset - props.rows.length) * rowHeight;

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
