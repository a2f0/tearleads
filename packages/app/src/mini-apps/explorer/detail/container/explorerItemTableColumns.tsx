import type { Icon } from "@phosphor-icons/react";
import type {
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortDirection,
  ContainerItemSortKey,
} from "@tearleads/client-sdk";
import { getStoredDocumentTypeLabel } from "@tearleads/client-sdk";
import type { MouseEvent, ReactNode } from "react";
import {
  MiniAppRowActionsButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableText,
} from "../../../../components/mini-app/MiniAppTable";
import { ContactAvatar } from "../../../../document-types/contact/ContactAvatar";
import type { AvatarUrlByContactId } from "../../../../document-types/contact/useContactAvatarUrls";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../../document-types/projectors";
import { getDocumentTypeIcon } from "../../../../document-types/registry";
import { getViewerRelativeContactDocumentLabel } from "../../../../stores/contacts/contactLabels";
import {
  formatMiniAppDate,
  formatMiniAppDateTime,
} from "../../../../utils/formatMiniAppDate";
import { ExplorerSyncStateBadge } from "../../ExplorerSyncStateBadge";
import { getExplorerContactAvatarUrl } from "../../explorerContactAvatar";
import { getExplorerContainerIcon } from "../../explorerContainerIcons";
import { EXPLORER_LABELS } from "../../labels";
import type { ExplorerItemColumnId } from "./explorerItemColumnIds";

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
    case "actions":
      return {
        className: "mini-app-row-actions-column",
        header: (
          <span className="mini-app-row-actions-heading">
            {EXPLORER_LABELS.itemActionsColumn}
          </span>
        ),
        id,
        width: "var(--mini-app-row-actions-column-width, 2.25rem)",
      };
    case "name":
      return {
        ariaSort: getSortAria(sort, "name"),
        id,
        header: sortableHeader("name", EXPLORER_LABELS.itemNameColumn),
        // On the phone tier the name leads and flexes to fill whatever space the
        // trimmed columns leave; on wider layouts it keeps a fixed share.
        width: compact ? undefined : "40%",
      };
    case "type":
      return {
        ariaSort: getSortAria(sort, "type"),
        id,
        header: sortableHeader("type", EXPLORER_LABELS.itemTypeColumn),
        width: compact ? "5.5rem" : "8rem",
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
        // On the phone tier the header shrinks to one word and the column is
        // sized to hold the date-only value (see the cell renderer) on a single
        // line, so the row keeps its fixed height and the virtual pitch holds.
        header: sortableHeader(
          "modified",
          compact
            ? EXPLORER_LABELS.dateModifiedColumnCompact
            : EXPLORER_LABELS.dateModifiedColumn,
        ),
        width: compact ? "9rem" : "11rem",
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
  columnIds: ReadonlyArray<ExplorerItemColumnId>;
  compact: boolean;
  onSort: (key: ContainerItemSortKey) => void;
  sort: ContainerItemSort;
}): ReadonlyArray<MiniAppTableColumn> {
  const { columnIds, compact, onSort, sort } = params;
  return columnIds.map((id) =>
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
  // Phone tier (useRoutedLayoutTier() === "mobile"): drives the date-only,
  // single-line rendering of the modified cell so the row height stays fixed.
  compact: boolean;
  // Object URLs for contact avatars, keyed by the contact document's local id.
  // Covers only contacts in the Explorer's contacts container; rows without an
  // entry keep the document-kind glyph.
  contactAvatarUrlByLocalId: AvatarUrlByContactId;
  currentSigningFingerprint: string | null | undefined;
  currentSelfContactLocalId: string | null | undefined;
  currentUserId: string | null | undefined;
  online: boolean;
  row: ContainerItemRow;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  onItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  setSelectedId: (id: string | null) => void;
}

function getExplorerContainerItemName(ctx: ExplorerItemCellContext): string {
  const { row } = ctx;
  if (row.itemKind !== "document") {
    return row.name;
  }

  return getViewerRelativeContactDocumentLabel({
    currentSigningFingerprint: ctx.currentSigningFingerprint,
    currentSelfContactLocalId: ctx.currentSelfContactLocalId,
    currentUserId: ctx.currentUserId,
    documentKind: row.documentKind,
    fallbackLabel: row.name,
    localId: row.localId,
  });
}

// A configured glyph for containers, otherwise the document kind's shared icon
// (the same mapping the "New Document" picker uses).
function getExplorerItemIcon(row: ContainerItemRow): {
  containerIcon: string | null;
  Icon: Icon;
  name: string;
} {
  if (row.itemKind === "container") {
    const containerIcon = getExplorerContainerIcon({
      icon: row.icon,
      isOpen: false,
    });
    return {
      containerIcon: containerIcon.containerIcon,
      Icon: containerIcon.Component,
      name: containerIcon.name,
    };
  }

  return {
    containerIcon: null,
    Icon: getDocumentTypeIcon(row.documentKind),
    name: row.documentKind,
  };
}

function ExplorerItemNameCell(ctx: ExplorerItemCellContext): ReactNode {
  const { row } = ctx;
  const name = getExplorerContainerItemName(ctx);
  const itemIcon = getExplorerItemIcon(row);
  const ItemIcon = itemIcon.Icon;
  const avatarUrl =
    row.itemKind === "document"
      ? getExplorerContactAvatarUrl(
          row.documentKind,
          row.localId,
          ctx.contactAvatarUrlByLocalId,
        )
      : undefined;
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
  //
  // On the phone tier the Type column is dropped and the leading icon is
  // aria-hidden, so fold the item kind into the button's accessible name to keep
  // it announced to screen readers ("Contacts, Folder"). The wide layout leaves
  // this off — the visible Type column already exposes the kind as table text.
  const accessibleName = ctx.compact
    ? `${name}, ${getExplorerContainerItemTypeLabel(row)}`
    : undefined;
  return (
    <MiniAppTableCell key="name">
      <button
        aria-label={accessibleName}
        className="explorer-item-row-button"
        data-document-local-id={
          row.itemKind === "document" ? row.localId : undefined
        }
        onClick={openItem}
        type="button"
      >
        <span className="explorer-item-name">
          {avatarUrl ? (
            // ContactAvatar already sizes and shrink-proofs itself, and it
            // deliberately skips the glyph classes' icon opacity — a dimmed
            // photograph reads as disabled rather than as a leading glyph.
            <ContactAvatar imageUrl={avatarUrl} size="small" />
          ) : (
            <ItemIcon
              aria-hidden="true"
              className="explorer-item-icon"
              data-container-icon={itemIcon.containerIcon ?? undefined}
              data-icon={itemIcon.name}
              focusable="false"
              size={16}
              weight="regular"
            />
          )}
          <MiniAppTableText title={name}>{name}</MiniAppTableText>
        </span>
      </button>
    </MiniAppTableCell>
  );
}

function ExplorerItemActionsCell(ctx: ExplorerItemCellContext): ReactNode {
  const { row } = ctx;
  const name = getExplorerContainerItemName(ctx);

  return (
    <MiniAppTableCell className="mini-app-row-actions-cell" key="actions">
      <MiniAppRowActionsButton
        aria-label={`${EXPLORER_LABELS.itemActionsButtonPrefix} ${name}`}
        onClick={(event) => {
          event.stopPropagation();
          ctx.onItemContextMenu(event, row);
        }}
        title={`${EXPLORER_LABELS.itemActionsButtonPrefix} ${name}`}
      />
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
    case "actions":
      return ExplorerItemActionsCell(ctx);
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
    case "modified": {
      const modifiedValue = (
        ctx.compact ? formatMiniAppDate : formatMiniAppDateTime
      )(row.updatedAt, { emptyFallback: EXPLORER_LABELS.unknownDate });
      return (
        <MiniAppTableCell key="modified" title={row.updatedAt ?? undefined}>
          {/* Date-only on phone so the value fits the narrow column. Wrap it in
              MiniAppTableText (single-line, ellipsis) so even a locale whose
              medium date is wider than the column clips instead of wrapping —
              keeping the row at its fixed height and the virtual pitch intact.
              The full timestamp stays available via the cell's title attribute
              and the item's Get Info panel. */}
          {ctx.compact ? (
            <MiniAppTableText>{modifiedValue}</MiniAppTableText>
          ) : (
            modifiedValue
          )}
        </MiniAppTableCell>
      );
    }
  }
}
