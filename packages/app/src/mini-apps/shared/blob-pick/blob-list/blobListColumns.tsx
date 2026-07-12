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
import { BLOB_LIST_LABELS } from "./blobListLabels";

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

// A host that renders no sync cell (e.g. the Notes pick surface) drops the sync
// column entirely rather than showing an empty one.
function getBlobInfoColumnIds(
  includeSync: boolean,
): ReadonlyArray<BlobInfoColumnId> {
  return includeSync
    ? BLOB_INFO_COLUMN_IDS
    : BLOB_INFO_COLUMN_IDS.filter((id) => id !== "sync");
}

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
      return BLOB_LIST_LABELS.blobColumn;
    case "mime":
      return BLOB_LIST_LABELS.mimeTypeColumn;
    case "size":
      return BLOB_LIST_LABELS.sizeColumn;
    case "references":
      return BLOB_LIST_LABELS.referenceColumn;
    case "updated":
      return BLOB_LIST_LABELS.updatedColumn;
    case "sync":
      return BLOB_LIST_LABELS.syncColumn;
  }
}

export function getBlobInfoColumnMenuOptions(
  includeSync: boolean,
): ReadonlyArray<MiniAppColumnMenuOption<BlobInfoColumnId>> {
  return BLOB_INFO_TOGGLEABLE_COLUMN_IDS.filter(
    (id) => includeSync || id !== "sync",
  ).map((id) => ({
    id,
    label: getBlobInfoColumnLabel(id),
  }));
}

export function getVisibleBlobInfoColumnIds(
  hiddenColumns: ReadonlySet<BlobInfoColumnId>,
  includeSync: boolean,
): ReadonlyArray<BlobInfoColumnId> {
  return getVisibleMiniAppTableColumnIds(
    getBlobInfoColumnIds(includeSync),
    hiddenColumns,
  );
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
  includeSync: boolean;
  onSort: (key: BlobInfoSortKey) => void;
  sort: BlobInfoSort;
}): ReadonlyArray<MiniAppTableColumn> {
  return getVisibleBlobInfoColumnIds(
    params.hiddenColumns,
    params.includeSync,
  ).map((id) => buildBlobInfoColumn(id, params));
}
