import type { BlobInfoSort, BlobInfoSortKey } from "@symcrypt/client-sdk";
import {
  getMiniAppTableSortAria,
  getVisibleMiniAppTableColumnIds,
  type MiniAppColumnMenuOption,
  type MiniAppTableColumn,
  MiniAppTableSortButton,
} from "../../../../components/mini-app/MiniAppTable";
import { BlobListCompactSortHeader } from "./BlobListCompactSortHeader";
import { BLOB_LIST_LABELS } from "./blobListLabels";

export type BlobInfoColumnId =
  | "blob"
  | "organization"
  | "mime"
  | "size"
  | "references"
  | "updated"
  | "sync";

export type BlobInfoCompactFieldColumnId = Exclude<BlobInfoColumnId, "blob">;

const BLOB_INFO_COLUMN_IDS: ReadonlyArray<BlobInfoColumnId> = [
  "blob",
  "organization",
  "mime",
  "size",
  "references",
  "updated",
  "sync",
];

export const BLOB_INFO_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<BlobInfoColumnId> =
  ["organization", "mime", "size", "references", "updated", "sync"];

// A host that renders no sync cell (e.g. the Notes pick surface) drops the sync
// column entirely rather than showing an empty one.
function getBlobInfoColumnIds(
  includeSync: boolean,
): ReadonlyArray<BlobInfoColumnId> {
  return includeSync
    ? BLOB_INFO_COLUMN_IDS
    : BLOB_INFO_COLUMN_IDS.filter((id) => id !== "sync");
}

export function getBlobInfoColumnLabel(id: BlobInfoColumnId): string {
  switch (id) {
    case "blob":
      return BLOB_LIST_LABELS.blobColumn;
    case "organization":
      return BLOB_LIST_LABELS.organizationColumn;
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
    <MiniAppTableSortButton
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
    case "organization":
      return {
        header: getBlobInfoColumnLabel(id),
        id,
        width: "12rem",
      };
    case "mime":
      return {
        ariaSort: getMiniAppTableSortAria(sort, "mimeType"),
        header: sortableHeader("mimeType", getBlobInfoColumnLabel(id)),
        id,
        // No fixed width: this is the flexible column that soaks up leftover
        // space now that the identity column is a narrow thumbnail.
        width: undefined,
      };
    case "size":
      return {
        ariaSort: getMiniAppTableSortAria(sort, "byteLength"),
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
        ariaSort: getMiniAppTableSortAria(sort, "updated"),
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

// The identity column becomes the summary's leading thumbnail rather than one of
// its text fields, so the folded lines carry every *other* visible column.
export function getBlobInfoCompactFieldColumnIds(
  visibleColumnIds: ReadonlyArray<BlobInfoColumnId>,
): ReadonlyArray<BlobInfoCompactFieldColumnId> {
  return visibleColumnIds.filter(
    (id): id is BlobInfoCompactFieldColumnId => id !== "blob",
  );
}

function buildBlobInfoSummaryColumn(params: {
  onSort: (key: BlobInfoSortKey) => void;
  sort: BlobInfoSort;
}): MiniAppTableColumn {
  return {
    // The selector names both the active field and its direction. The summary
    // cell beneath it stands for several fields, so an `aria-sort` on the <th>
    // would announce an incomplete sort state.
    ariaSort: "none",
    header: (
      <BlobListCompactSortHeader onSort={params.onSort} sort={params.sort} />
    ),
    id: "summary",
  };
}

export function getBlobInfoColumns(params: {
  // A folded list — a phone, or any pane too narrow for the columns — replaces
  // the data columns with one two-line summary column.
  compact: boolean;
  hiddenColumns: ReadonlySet<BlobInfoColumnId>;
  includeSync: boolean;
  onSort: (key: BlobInfoSortKey) => void;
  sort: BlobInfoSort;
}): ReadonlyArray<MiniAppTableColumn> {
  if (params.compact) {
    return [buildBlobInfoSummaryColumn(params)];
  }

  return getVisibleBlobInfoColumnIds(
    params.hiddenColumns,
    params.includeSync,
  ).map((id) => buildBlobInfoColumn(id, params));
}
