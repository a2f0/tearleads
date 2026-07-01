import type { Icon } from "@phosphor-icons/react";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import type {
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortDirection,
  ContainerItemSortKey,
} from "@tearleads/client-sdk";
import { getStoredDocumentTypeLabel } from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import {
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableText,
} from "../../../components/shared/MiniAppTable";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../document-types/projectors";
import { getDocumentTypeIcon } from "../../../document-types/registry";
import { getViewerRelativeContactDocumentLabel } from "../../../stores/contacts/contactLabels";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { ExplorerSyncStateBadge } from "../ExplorerSyncStateBadge";
import { EXPLORER_LABELS } from "../labels";
import {
  type ExplorerItemColumnId,
  getVisibleExplorerItemColumnIds,
} from "./explorerItemColumnIds";

function getSortAria(
  sort: ContainerItemSort,
  key: ContainerItemSortKey,
): MiniAppTableColumn["ariaSort"] {
  if (sort.key !== key) {
    return "none";
  }

  return sort.direction === "asc" ? "ascending" : "descending";
}

function ExplorerSortableTableHeader(params: {
  activeDirection: ContainerItemSortDirection | null;
  label: string;
  onClick: () => void;
}) {
  const { activeDirection, label, onClick } = params;

  return (
    <button
      type="button"
      className="explorer-table-sort-button"
      onClick={onClick}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="explorer-table-sort-indicator">
        {activeDirection === "asc"
          ? "^"
          : activeDirection === "desc"
            ? "v"
            : ""}
      </span>
    </button>
  );
}

interface ColumnBuildContext {
  compact: boolean;
  onSort: (key: ContainerItemSortKey) => void;
  sort: ContainerItemSort;
}

function buildExplorerItemColumn(
  id: ExplorerItemColumnId,
  ctx: ColumnBuildContext,
): MiniAppTableColumn {
  const { compact, onSort, sort } = ctx;
  const sortableHeader = (key: ContainerItemSortKey, label: string) => (
    <ExplorerSortableTableHeader
      activeDirection={sort.key === key ? sort.direction : null}
      label={label}
      onClick={() => onSort(key)}
    />
  );

  switch (id) {
    case "name":
      return {
        id,
        header: EXPLORER_LABELS.itemNameColumn,
        // On the phone tier the name leads and flexes to fill whatever space the
        // trimmed columns leave; on wider layouts it keeps a fixed share.
        width: compact ? undefined : "40%",
      };
    case "type":
      return {
        ariaSort: getSortAria(sort, "type"),
        id,
        header: sortableHeader("type", EXPLORER_LABELS.itemTypeColumn),
        width: compact ? "6rem" : "8rem",
      };
    case "created":
      return {
        ariaSort: getSortAria(sort, "created"),
        id,
        header: sortableHeader("created", EXPLORER_LABELS.dateCreatedColumn),
        width: "11rem",
      };
    case "modified":
      return {
        ariaSort: getSortAria(sort, "modified"),
        id,
        header: sortableHeader("modified", EXPLORER_LABELS.dateModifiedColumn),
        width: compact ? "10rem" : "11rem",
      };
    case "sync":
      return {
        id,
        header: EXPLORER_LABELS.itemSyncColumn,
        width: "7rem",
      };
  }
}

export function getExplorerItemTableColumns(params: {
  compact: boolean;
  hiddenColumns: ReadonlySet<ExplorerItemColumnId>;
  onSort: (key: ContainerItemSortKey) => void;
  sort: ContainerItemSort;
}): ReadonlyArray<MiniAppTableColumn> {
  const { compact, hiddenColumns, onSort, sort } = params;
  return getVisibleExplorerItemColumnIds({ compact, hiddenColumns }).map((id) =>
    buildExplorerItemColumn(id, { compact, onSort, sort }),
  );
}

function getExplorerContainerItemTypeLabel(row: ContainerItemRow): string {
  if (row.itemKind === "container") {
    return EXPLORER_LABELS.folderType;
  }

  return getStoredDocumentTypeLabel(
    row.documentKind,
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
}

export interface ExplorerItemCellContext {
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  online: boolean;
  row: ContainerItemRow;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
}

function getExplorerContainerItemName(ctx: ExplorerItemCellContext): string {
  const { row } = ctx;
  if (row.itemKind !== "document") {
    return row.name;
  }

  return getViewerRelativeContactDocumentLabel({
    currentSigningFingerprint: ctx.currentSigningFingerprint,
    currentUserId: ctx.currentUserId,
    documentKind: row.documentKind,
    fallbackLabel: row.name,
    localId: row.localId,
  });
}

// A folder glyph for containers, otherwise the document kind's shared icon
// (the same mapping the "New Document" picker uses).
function getExplorerItemIcon(row: ContainerItemRow): Icon {
  if (row.itemKind === "container") {
    return FolderIcon;
  }

  return getDocumentTypeIcon(row.documentKind);
}

function ExplorerItemNameCell(ctx: ExplorerItemCellContext): ReactNode {
  const { row } = ctx;
  const name = getExplorerContainerItemName(ctx);
  const ItemIcon = getExplorerItemIcon(row);
  const openItem = () => {
    if (row.itemKind === "container") {
      ctx.setSelectedId(row.id);
      return;
    }

    ctx.selectDocumentProjection(row.localId, row.containerId);
  };

  // Keep standard table-row semantics: a native button in the name cell carries
  // the click/keyboard behaviour, and a CSS ::after overlay (see Explorer.css)
  // stretches its hit area across the whole row so the entire row is clickable.
  return (
    <MiniAppTableCell key="name">
      <button
        className="explorer-item-row-button"
        onClick={openItem}
        type="button"
      >
        <span className="explorer-item-name">
          <ItemIcon
            aria-hidden="true"
            className="explorer-item-icon"
            focusable="false"
            size={16}
            weight="regular"
          />
          <MiniAppTableText title={name}>{name}</MiniAppTableText>
        </span>
      </button>
    </MiniAppTableCell>
  );
}

// Returns the cell for one column id. Driven by the same visible-column-id list
// as the header columns so the two never desync. The returned element carries a
// stable key so callers can map directly over the column ids.
export function renderExplorerItemCell(
  columnId: ExplorerItemColumnId,
  ctx: ExplorerItemCellContext,
): ReactNode {
  const { row } = ctx;
  switch (columnId) {
    case "name":
      return ExplorerItemNameCell(ctx);
    case "type":
      return (
        <MiniAppTableCell key="type">
          {getExplorerContainerItemTypeLabel(row)}
        </MiniAppTableCell>
      );
    case "sync":
      return (
        <MiniAppTableCell key="sync">
          <ExplorerSyncStateBadge
            online={ctx.online}
            showSynced
            syncState={row.syncState}
          />
        </MiniAppTableCell>
      );
    case "created":
      return (
        <MiniAppTableCell key="created" title={row.createdAt ?? undefined}>
          {formatMiniAppDateTime(row.createdAt, {
            emptyFallback: EXPLORER_LABELS.unknownDate,
          })}
        </MiniAppTableCell>
      );
    case "modified":
      return (
        <MiniAppTableCell key="modified" title={row.updatedAt ?? undefined}>
          {formatMiniAppDateTime(row.updatedAt, {
            emptyFallback: EXPLORER_LABELS.unknownDate,
          })}
        </MiniAppTableCell>
      );
  }
}
