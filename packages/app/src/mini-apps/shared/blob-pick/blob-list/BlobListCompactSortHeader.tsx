import type { BlobInfoSort, BlobInfoSortKey } from "@tearleads/client-sdk";
import { MiniAppSelectMenu } from "../../../../components/mini-app/controls/MiniAppSelectMenu";
import { BLOB_LIST_LABELS } from "./blobListLabels";

// The folded list has one column, so the per-column sort buttons have nowhere
// to live. A select menu carries the same three keys in the summary header.
const COMPACT_SORT_LABELS: Readonly<Record<BlobInfoSortKey, string>> = {
  byteLength: BLOB_LIST_LABELS.sizeColumn,
  mimeType: BLOB_LIST_LABELS.mimeTypeColumn,
  updated: BLOB_LIST_LABELS.updatedColumn,
};

function defineAllSortKeys<const Keys extends readonly BlobInfoSortKey[]>(
  ...keys: Keys & ([BlobInfoSortKey] extends [Keys[number]] ? unknown : never)
): Keys {
  return keys;
}

// The helper makes additions to BlobInfoSortKey fail here until ordered.
const COMPACT_SORT_KEYS = defineAllSortKeys(
  "mimeType",
  "byteLength",
  "updated",
);

function isBlobInfoSortKey(value: string): value is BlobInfoSortKey {
  return COMPACT_SORT_KEYS.some((key) => key === value);
}

export function BlobListCompactSortHeader(params: {
  onSort: (key: BlobInfoSortKey) => void;
  sort: BlobInfoSort;
}) {
  const { onSort, sort } = params;
  const stateLabel =
    sort.direction === "asc"
      ? BLOB_LIST_LABELS.columnSortedAscending
      : BLOB_LIST_LABELS.columnSortedDescending;
  const directionIndicator = sort.direction === "asc" ? "↑" : "↓";

  return (
    <>
      <span className="mini-app-compact-table-field-label">
        {BLOB_LIST_LABELS.blobColumn}:{" "}
      </span>
      <MiniAppSelectMenu
        ariaLabel={`${BLOB_LIST_LABELS.sortMenuLabel}: ${COMPACT_SORT_LABELS[sort.key]}, ${stateLabel}`}
        className="explorer-blob-browser-sort-menu"
        onChange={(value) => {
          if (isBlobInfoSortKey(value)) {
            onSort(value);
          }
        }}
        options={COMPACT_SORT_KEYS.map((key) => ({
          id: key,
          label: COMPACT_SORT_LABELS[key],
          secondaryLabel:
            key === sort.key
              ? `${stateLabel}. ${BLOB_LIST_LABELS.sortReverseAction}`
              : undefined,
          triggerLabel:
            key === sort.key
              ? `${COMPACT_SORT_LABELS[key]} ${directionIndicator}`
              : COMPACT_SORT_LABELS[key],
        }))}
        portaled
        value={sort.key}
      />
    </>
  );
}
