import type { BlobInfoSort, BlobInfoSortKey } from "@tearleads/client-sdk";
import { MiniAppCompactSortMenu } from "../../../../components/mini-app/MiniAppTable";
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

export function BlobListCompactSortHeader(params: {
  onSort: (key: BlobInfoSortKey) => void;
  sort: BlobInfoSort;
}) {
  return (
    <MiniAppCompactSortMenu
      keys={COMPACT_SORT_KEYS}
      labels={COMPACT_SORT_LABELS}
      leadingLabel={BLOB_LIST_LABELS.blobColumn}
      onSort={params.onSort}
      sort={params.sort}
      sortLabels={{
        ascending: BLOB_LIST_LABELS.columnSortedAscending,
        descending: BLOB_LIST_LABELS.columnSortedDescending,
        menu: BLOB_LIST_LABELS.sortMenuLabel,
        reverse: BLOB_LIST_LABELS.sortReverseAction,
      }}
    />
  );
}
