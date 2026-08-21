import type { Icon } from "@phosphor-icons/react";
import type {
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortKey,
} from "@symcrypt/client-sdk";
import { getStoredDocumentTypeLabel } from "@symcrypt/client-sdk";
import type { MouseEvent, ReactNode } from "react";
import {
  getMiniAppTableSortAria,
  MiniAppRowActionsButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableSortButton,
  MiniAppTableText,
  miniAppRowActionsColumn,
} from "../../../../components/mini-app/MiniAppTable";
import { ContactAvatar } from "../../../../document-types/contact/ContactAvatar";
import type { AvatarUrlByContactId } from "../../../../document-types/contact/useContactAvatarUrls";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../../document-types/projectors";
import { getDocumentTypeIcon } from "../../../../document-types/registry";
import { getViewerRelativeContactDocumentLabel } from "../../../../stores/contacts/contactLabels";
import { explorerDocumentRouteContainerId } from "../../../../stores/explorer/orphanedDocuments";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerSyncStateBadge } from "../../shared/ExplorerSyncStateBadge";
import { getExplorerContactAvatar } from "../../shared/explorerContactAvatar";
import { getExplorerContainerIcon } from "../../shared/explorerContainerIcons";
import { ExplorerCompactSortHeader } from "../ExplorerCompactSortHeader";
import type { ExplorerItemColumnId } from "./explorerItemColumnIds";
import "./ExplorerContainerDetail.css";

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
    <MiniAppTableSortButton
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
        ariaSort: getMiniAppTableSortAria(sort, "name"),
        id,
        header: sortableHeader("name", EXPLORER_LABELS.itemNameColumn),
        width: "40%",
      };
    case "type":
      return {
        ariaSort: getMiniAppTableSortAria(sort, "type"),
        id,
        header: sortableHeader("type", EXPLORER_LABELS.itemTypeColumn),
        width: "8rem",
      };
    case "created":
      return {
        ariaSort: getMiniAppTableSortAria(sort, "created"),
        id,
        header: sortableHeader("created", EXPLORER_LABELS.dateCreatedColumn),
        width: "11rem",
      };
    case "modified":
      return {
        ariaSort: getMiniAppTableSortAria(sort, "modified"),
        id,
        header: sortableHeader("modified", EXPLORER_LABELS.dateModifiedColumn),
        width: "11rem",
      };
    case "sync":
      return {
        id,
        header: EXPLORER_LABELS.itemSyncColumn,
        // Wide enough for the header word; the cell below it is a single glyph.
        width: "4.5rem",
      };
    case "summary":
      return {
        // The selector identifies both the active field and direction. The
        // summary cell itself represents multiple fields, so announcing a
        // direction on the <th> would duplicate an incomplete sort state.
        ariaSort: "none",
        id,
        header: <ExplorerCompactSortHeader onSort={onSort} sort={sort} />,
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
  // Covers only contacts in the Explorer's contacts container; ContactAvatar
  // supplies the shared silhouette when a row has no entry.
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

  ctx.selectDocumentProjection(
    row.localId,
    explorerDocumentRouteContainerId(row.containerId),
  );
}

function getExplorerItemVisual(
  ctx: ExplorerItemCellContext,
  options: { compact: boolean },
): ReactNode {
  const { row } = ctx;
  const itemIcon = getExplorerItemIcon(row);
  const ItemIcon = itemIcon.Icon;
  const contactAvatar =
    row.itemKind === "document"
      ? getExplorerContactAvatar(
          row.documentKind,
          row.localId,
          ctx.contactAvatarUrlByLocalId,
        )
      : null;

  return contactAvatar ? (
    // ContactAvatar owns both the image and the shared no-avatar silhouette.
    // It also shrink-proofs itself without the generic glyph opacity.
    <ContactAvatar
      imageUrl={contactAvatar.imageUrl}
      size={options.compact ? "medium" : "small"}
    />
  ) : (
    <ItemIcon
      aria-hidden="true"
      className="explorer-item-icon"
      data-container-icon={itemIcon.containerIcon ?? undefined}
      data-icon={itemIcon.name}
      focusable="false"
      size={options.compact ? 32 : 16}
      weight="regular"
    />
  );
}

// Keep standard table-row semantics: a native button owns click and keyboard
// behavior, while the row handles clicks elsewhere. The compact summary lets
// its spanning visual sit outside this otherwise-identical name control.
function ExplorerItemNameButton(
  ctx: ExplorerItemCellContext,
  options: { showVisual: boolean } = { showVisual: true },
): ReactNode {
  const { row } = ctx;
  const name = getExplorerContainerItemName(ctx);

  return (
    <button
      className="explorer-item-row-button"
      data-document-local-id={
        row.itemKind === "document" ? row.localId : undefined
      }
      onClick={() => openExplorerItem(ctx)}
      type="button"
    >
      <span className="explorer-item-name">
        {options.showVisual
          ? getExplorerItemVisual(ctx, { compact: false })
          : null}
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

function ExplorerItemSummaryCell(ctx: ExplorerItemCellContext): ReactNode {
  const type = getExplorerContainerItemTypeLabel(ctx.row);

  return (
    <MiniAppTableCell key="summary">
      <span className="explorer-item-summary">
        <span className="explorer-item-summary-visual">
          {getExplorerItemVisual(ctx, { compact: true })}
        </span>
        <span className="explorer-item-summary-copy">
          {ExplorerItemNameButton(ctx, { showVisual: false })}
          <span className="explorer-item-summary-type" title={type}>
            <span className="explorer-item-summary-field-label">
              {EXPLORER_LABELS.itemTypeColumn}:{" "}
            </span>
            {type}
          </span>
        </span>
      </span>
    </MiniAppTableCell>
  );
}

function ExplorerItemActionsCell(ctx: ExplorerItemCellContext): ReactNode {
  const { row } = ctx;
  if (row.itemKind === "document" && row.containerId === null) {
    return (
      <MiniAppTableCell className="mini-app-row-actions-cell" key="actions" />
    );
  }

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
