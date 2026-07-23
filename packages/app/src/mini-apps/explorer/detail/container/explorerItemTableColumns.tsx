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
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppCompactTableHeader,
  MiniAppRowActionsButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableText,
  miniAppRowActionsColumn,
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
import {
  COMPACT_SUMMARY_SECONDARY_COLUMN_IDS,
  type ExplorerItemColumnId,
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

// The sortable data columns the phone summary folds together. `type` is not
// sortable on the wide layout's phone predecessor, but it is shown on line two
// now, so its header earns a sort control alongside the two that already had one.
const SUMMARY_SORT_KEYS: ReadonlyArray<ContainerItemSortKey> = [
  "name",
  "type",
  "modified",
];

const SUMMARY_SORT_LABELS: Readonly<Record<ContainerItemSortKey, string>> = {
  created: EXPLORER_LABELS.dateCreatedColumn,
  modified: EXPLORER_LABELS.dateModifiedColumnCompact,
  name: EXPLORER_LABELS.itemNameColumn,
  type: EXPLORER_LABELS.itemTypeColumn,
};

interface ColumnBuildContext {
  columnMenu?: ReactNode;
  onSort: (key: ContainerItemSortKey) => void;
  sort: ContainerItemSort;
}

function buildExplorerItemColumn(
  id: ExplorerItemColumnId,
  ctx: ColumnBuildContext,
): MiniAppTableColumn {
  const { columnMenu, onSort, sort } = ctx;
  const sortableHeader = (key: ContainerItemSortKey, label: string) => (
    <ExplorerSortableTableHeader
      activeDirection={sort.key === key ? sort.direction : null}
      label={label}
      onClick={() => onSort(key)}
    />
  );

  switch (id) {
    case "actions":
      return miniAppRowActionsColumn(
        EXPLORER_LABELS.itemActionsColumn,
        columnMenu,
      );
    case "name":
      return {
        ariaSort: getSortAria(sort, "name"),
        id,
        header: sortableHeader("name", EXPLORER_LABELS.itemNameColumn),
        width: "40%",
      };
    case "type":
      return {
        ariaSort: getSortAria(sort, "type"),
        id,
        header: sortableHeader("type", EXPLORER_LABELS.itemTypeColumn),
        width: "8rem",
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
        width: "11rem",
      };
    case "sync":
      return {
        id,
        header: EXPLORER_LABELS.itemSyncColumn,
        width: "7rem",
      };
    case "summary":
      return {
        // The header is one line of sort controls even though the cells below
        // stack two: each `.explorer-table-sort-button` is floored at the 44px
        // touch target on routed layouts, so stacking them would double the
        // sticky header's height on the tier with the least room for it.
        ariaSort: SUMMARY_SORT_KEYS.includes(sort.key)
          ? getSortAria(sort, sort.key)
          : "none",
        id,
        header: (
          <MiniAppCompactTableHeader
            primary={SUMMARY_SORT_KEYS.map((key) => ({
              content: sortableHeader(key, SUMMARY_SORT_LABELS[key]),
              id: key,
            }))}
            secondary={[]}
          />
        ),
      };
  }
}

export function getExplorerItemTableColumns(params: {
  columnIds: ReadonlyArray<ExplorerItemColumnId>;
  columnMenu?: ReactNode;
  onSort: (key: ContainerItemSortKey) => void;
  sort: ContainerItemSort;
}): ReadonlyArray<MiniAppTableColumn> {
  const { columnIds, columnMenu, onSort, sort } = params;
  return columnIds.map((id) =>
    buildExplorerItemColumn(id, { columnMenu, onSort, sort }),
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

// Opening an item: containers become the pane's selection, documents route to
// their projection. Shared by the name cell's button and the row-wide click
// target (see `onActivate` on MiniAppTableRow) so both do exactly the same thing.
export function openExplorerItem(
  ctx: Pick<
    ExplorerItemCellContext,
    "row" | "selectDocumentProjection" | "setSelectedId"
  >,
): void {
  const { row } = ctx;
  if (row.itemKind === "container") {
    ctx.setSelectedId(row.id);
    return;
  }

  ctx.selectDocumentProjection(row.localId, row.containerId);
}

// Keep standard table-row semantics: a native button carries the
// click/keyboard behaviour, and the row itself carries the same action for
// clicks that land anywhere else in the row. Shared by the wide layout's Name
// cell and the phone summary's first line, so both render the identical
// element — the screenshot and integration suites locate rows through it.
function ExplorerItemNameButton(ctx: ExplorerItemCellContext): ReactNode {
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
    openExplorerItem(ctx);
  };

  return (
    <button
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
  );
}

function ExplorerItemNameCell(ctx: ExplorerItemCellContext): ReactNode {
  return (
    <MiniAppTableCell key="name">
      {ExplorerItemNameButton(ctx)}
    </MiniAppTableCell>
  );
}

function getExplorerItemSummaryField(
  columnId: ExplorerItemColumnId,
  ctx: ExplorerItemCellContext,
): MiniAppCompactTableField | null {
  const { row } = ctx;
  switch (columnId) {
    case "type":
      return {
        id: columnId,
        label: EXPLORER_LABELS.itemTypeColumn,
        text: getExplorerContainerItemTypeLabel(row),
      };
    case "modified":
      return {
        id: columnId,
        label: EXPLORER_LABELS.dateModifiedColumnCompact,
        // Date-only so the line never wraps: the row has to stay exactly at the
        // virtual pitch. The full timestamp stays on the field's title and in
        // the item's Get Info panel.
        text: formatMiniAppDate(row.updatedAt, {
          emptyFallback: EXPLORER_LABELS.unknownDate,
        }),
        title: row.updatedAt ?? undefined,
      };
    default:
      return null;
  }
}

function ExplorerItemSummaryCell(ctx: ExplorerItemCellContext): ReactNode {
  // The first line carries no `label`, so the shared visually-hidden prefix is
  // skipped and the row button's accessible name stays the bare item name. The
  // kind is announced by the second line's "Type: " prefix instead.
  //
  // The second line leads with an empty gutter field so its tracks line up with
  // the header's: the lines share one equal-track grid, so without it Type
  // would sit under the Name header rather than under Type. The name itself is
  // the sole field on line one, so it still spans the full width.
  return (
    <MiniAppCompactTableCell
      key="summary"
      primary={[{ content: ExplorerItemNameButton(ctx), id: "name" }]}
      secondary={[
        { id: "name-gutter" },
        ...COMPACT_SUMMARY_SECONDARY_COLUMN_IDS.flatMap((columnId) => {
          const field = getExplorerItemSummaryField(columnId, ctx);
          return field ? [field] : [];
        }),
      ]}
    />
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
    case "summary":
      return ExplorerItemSummaryCell(ctx);
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
