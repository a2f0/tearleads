import type {
  BlobInfoSort,
  BlobInfoSortDirection,
  BlobInfoSortKey,
} from "@tearleads/client-sdk";
import type { MiniAppTableColumn } from "../../../components/shared/MiniAppTable";
import { EXPLORER_LABELS } from "../labels";

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

export function getBlobInfoColumns(params: {
  onSort: (key: BlobInfoSortKey) => void;
  sort: BlobInfoSort;
}): ReadonlyArray<MiniAppTableColumn> {
  const { onSort, sort } = params;
  const sortableHeader = (key: BlobInfoSortKey, label: string) => (
    <BlobSortableTableHeader
      activeDirection={sort.key === key ? sort.direction : null}
      label={label}
      onClick={() => onSort(key)}
    />
  );

  return [
    {
      header: EXPLORER_LABELS.blobBrowserBlobColumn,
      id: "blob",
      width: "34%",
    },
    {
      ariaSort: getBlobSortAria(sort, "mimeType"),
      header: sortableHeader(
        "mimeType",
        EXPLORER_LABELS.blobBrowserMimeTypeColumn,
      ),
      id: "mime",
      width: "11rem",
    },
    {
      ariaSort: getBlobSortAria(sort, "byteLength"),
      header: sortableHeader(
        "byteLength",
        EXPLORER_LABELS.blobBrowserSizeColumn,
      ),
      id: "size",
      width: "7rem",
    },
    {
      header: EXPLORER_LABELS.blobBrowserReferenceColumn,
      id: "references",
      width: "8rem",
    },
    {
      ariaSort: getBlobSortAria(sort, "updated"),
      header: sortableHeader(
        "updated",
        EXPLORER_LABELS.blobBrowserUpdatedColumn,
      ),
      id: "updated",
      width: "11rem",
    },
  ];
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
