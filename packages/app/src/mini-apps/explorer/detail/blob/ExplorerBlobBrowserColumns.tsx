import type {
  BlobInfoSort,
  BlobInfoSortDirection,
  BlobInfoSortKey,
} from "@tearleads/client-sdk";
import {
  getVisibleMiniAppTableColumnIds,
  type MiniAppColumnMenuOption,
  type MiniAppTableColumn,
} from "../../../../components/shared/MiniAppTable";
import { EXPLORER_LABELS } from "../../labels";

export type BlobInfoColumnId =
  | "blob"
  | "mime"
  | "size"
  | "references"
  | "updated"
  | "sync";

const BLOB_INFO_COLUMN_IDS: ReadonlyArray<BlobInfoColumnId> = [
  "blob",
  "mime",
  "size",
  "references",
  "updated",
  "sync",
];

export const BLOB_INFO_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<BlobInfoColumnId> =
  ["mime", "size", "references", "updated", "sync"];

function getBlobSortAria(
  sort: BlobInfoSort,
  key: BlobInfoSortKey,
): MiniAppTableColumn["ariaSort"] {
  if (sort.key !== key) {
    return "none";
  }

  return sort.direction === "asc" ? "ascending" : "descending";
}

function BlobSortableTableHeader(params: {
  activeDirection: BlobInfoSortDirection | null;
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

function getBlobInfoColumnLabel(id: BlobInfoColumnId): string {
  switch (id) {
    case "blob":
      return EXPLORER_LABELS.blobBrowserBlobColumn;
    case "mime":
      return EXPLORER_LABELS.blobBrowserMimeTypeColumn;
    case "size":
      return EXPLORER_LABELS.blobBrowserSizeColumn;
    case "references":
      return EXPLORER_LABELS.blobBrowserReferenceColumn;
    case "updated":
      return EXPLORER_LABELS.blobBrowserUpdatedColumn;
    case "sync":
      return EXPLORER_LABELS.itemSyncColumn;
  }
}

export const BLOB_INFO_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<BlobInfoColumnId>
> = BLOB_INFO_TOGGLEABLE_COLUMN_IDS.map((id) => ({
  id,
  label: getBlobInfoColumnLabel(id),
}));

export function getVisibleBlobInfoColumnIds(
  hiddenColumns: ReadonlySet<BlobInfoColumnId>,
): ReadonlyArray<BlobInfoColumnId> {
  return getVisibleMiniAppTableColumnIds(BLOB_INFO_COLUMN_IDS, hiddenColumns);
}

function buildBlobInfoColumn(
  id: BlobInfoColumnId,
  params: {
    onSort: (key: BlobInfoSortKey) => void;
    sort: BlobInfoSort;
  },
): MiniAppTableColumn {
  const { onSort, sort } = params;
  const sortableHeader = (key: BlobInfoSortKey, label: string) => (
    <BlobSortableTableHeader
      activeDirection={sort.key === key ? sort.direction : null}
      label={label}
      onClick={() => onSort(key)}
    />
  );

  switch (id) {
    case "blob":
      // Thumbnail-only column: keep it tight and let mime absorb the slack.
      return {
        header: getBlobInfoColumnLabel(id),
        id,
        width: "4rem",
      };
    case "mime":
      return {
        ariaSort: getBlobSortAria(sort, "mimeType"),
        header: sortableHeader("mimeType", getBlobInfoColumnLabel(id)),
        id,
        // No fixed width: this is the flexible column that soaks up leftover
        // space now that the identity column is a narrow thumbnail.
        width: undefined,
      };
    case "size":
      return {
        ariaSort: getBlobSortAria(sort, "byteLength"),
        header: sortableHeader("byteLength", getBlobInfoColumnLabel(id)),
        id,
        width: "7rem",
      };
    case "references":
      return {
        header: getBlobInfoColumnLabel(id),
        id,
        width: "8rem",
      };
    case "updated":
      return {
        ariaSort: getBlobSortAria(sort, "updated"),
        header: sortableHeader("updated", getBlobInfoColumnLabel(id)),
        id,
        width: "11rem",
      };
    case "sync":
      return {
        header: getBlobInfoColumnLabel(id),
        id,
        width: "7rem",
      };
  }
}

export function getBlobInfoColumns(params: {
  hiddenColumns: ReadonlySet<BlobInfoColumnId>;
  onSort: (key: BlobInfoSortKey) => void;
  sort: BlobInfoSort;
}): ReadonlyArray<MiniAppTableColumn> {
  return getVisibleBlobInfoColumnIds(params.hiddenColumns).map((id) =>
    buildBlobInfoColumn(id, params),
  );
}

export function getBlobReferenceColumns(): ReadonlyArray<MiniAppTableColumn> {
  return [
    {
      header: EXPLORER_LABELS.blobBrowserDocumentColumn,
      id: "document",
      width: "46%",
    },
    {
      header: EXPLORER_LABELS.documentInfoContainerColumn,
      id: "container",
      width: "28%",
    },
    {
      header: EXPLORER_LABELS.blobBrowserStateColumn,
      id: "state",
      width: "6rem",
    },
    {
      header: EXPLORER_LABELS.blobBrowserSlotColumn,
      id: "slot",
      width: "8rem",
    },
  ];
}
