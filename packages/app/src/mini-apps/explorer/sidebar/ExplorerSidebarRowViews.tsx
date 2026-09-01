import type { ContainerDocumentSidebarRow } from "@tearleads/client-sdk";
import type { MouseEvent } from "react";
import {
  MiniAppRow,
  MiniAppRowButton,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { MiniAppVirtualBlockSpacer } from "../../../components/mini-app/virtual/MiniAppVirtual";
import { ContactAvatar } from "../../../document-types/contact/ContactAvatar";
import type { AvatarUrlByContactId } from "../../../document-types/contact/useContactAvatarUrls";
import { getDocumentTypeIcon } from "../../../document-types/registry";
import { useTouchRowHeight } from "../../../navigation/useTouchRowHeight";
import { getViewerRelativeContactDocumentLabel } from "../../../stores/contacts/contactLabels";
import {
  explorerDocumentRouteContainerId,
  isExplorerOrphanedDocumentsId,
} from "../../../stores/explorer/orphanedDocuments";
import { getExplorerContactAvatar } from "../shared/explorerContactAvatar";
import { getExplorerContainerIcon } from "../shared/explorerContainerIcons";
import {
  type ExplorerSidebarVirtualRow,
  getLoadedExplorerSidebarDocumentRow,
} from "./ExplorerSidebarRows";
import {
  EXPLORER_SIDEBAR_ROW_HEIGHT,
  type ExplorerTreeEntry,
} from "./explorerTreeModel";

export interface ExplorerSidebarRowProps {
  activeContainerId: string | null;
  // Object URLs for contact avatars, keyed by the contact document's local id.
  // Covers only contacts in the Explorer's contacts container; ContactAvatar
  // supplies the shared silhouette when a row has no entry.
  contactAvatarUrlByLocalId: AvatarUrlByContactId;
  currentSigningFingerprint: string | null | undefined;
  currentSelfContactLocalId: string | null | undefined;
  currentUserId: string | null | undefined;
  depth: number;
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

function ExplorerTreeDocumentRow(
  props: Omit<
    ExplorerSidebarRowProps,
    "onContextMenu" | "onToggleCollapsed"
  > & {
    row: ContainerDocumentSidebarRow;
  },
) {
  const { row } = props;
  const sourceContainerId = row.containerId;
  const title = getViewerRelativeContactDocumentLabel({
    currentSigningFingerprint: props.currentSigningFingerprint,
    currentSelfContactLocalId: props.currentSelfContactLocalId,
    currentUserId: props.currentUserId,
    documentKind: row.documentKind,
    fallbackLabel: row.title,
    localId: row.localId,
  });
  const DocumentGlyph = getDocumentTypeIcon(row.documentKind);
  const contactAvatar = getExplorerContactAvatar(
    row.documentKind,
    row.localId,
    props.contactAvatarUrlByLocalId,
  );

  return (
    <div
      className="explorer-sidebar-row"
      style={getExplorerSidebarRowStyle(props.depth)}
    >
      <span className="explorer-node-spacer" aria-hidden="true" />
      <MiniAppRowButton
        data-document-local-id={row.localId}
        className="explorer-sidebar-item explorer-sidebar-item--note"
        onClick={() =>
          props.onSelectDocument(
            row.localId,
            explorerDocumentRouteContainerId(sourceContainerId),
          )
        }
        onContextMenu={(event) => {
          if (sourceContainerId === null) {
            event.preventDefault();
            return;
          }
          props.onDocumentContextMenu(event, row.localId, sourceContainerId);
        }}
        selected={
          props.selectedId === row.localId &&
          props.activeContainerId ===
            explorerDocumentRouteContainerId(sourceContainerId)
        }
      >
        {contactAvatar ? (
          // ContactAvatar owns both the image and the shared no-avatar
          // silhouette, while also shrink-proofing itself.
          <ContactAvatar imageUrl={contactAvatar.imageUrl} size="small" />
        ) : (
          <DocumentGlyph
            aria-hidden="true"
            className="explorer-document-icon"
            data-icon={row.documentKind}
            focusable="false"
            size={16}
            weight="regular"
          />
        )}
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
