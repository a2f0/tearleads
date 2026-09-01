import type {
  ContainerItemSort,
  ContainerItemSortKey,
} from "@tearleads/client-sdk";
import { MiniAppCompactSortMenu } from "../../../components/mini-app/MiniAppTable";
import { EXPLORER_LABELS } from "../labels";

const COMPACT_SORT_LABELS: Readonly<Record<ContainerItemSortKey, string>> = {
  created: EXPLORER_LABELS.dateCreatedColumn,
  modified: EXPLORER_LABELS.dateModifiedColumnCompact,
  name: EXPLORER_LABELS.itemNameColumn,
  type: EXPLORER_LABELS.itemTypeColumn,
};

function defineAllSortKeys<const Keys extends readonly ContainerItemSortKey[]>(
  ...keys: Keys &
    ([ContainerItemSortKey] extends [Keys[number]] ? unknown : never)
): Keys {
  return keys;
}

// The helper makes additions to ContainerItemSortKey fail here until ordered.
const COMPACT_SORT_KEYS = defineAllSortKeys(
  "name",
  "type",
  "created",
  "modified",
);

export function ExplorerCompactSortHeader(params: {
  onSort: (key: ContainerItemSortKey) => void;
  sort: ContainerItemSort;
}) {
  return (
    <MiniAppCompactSortMenu
      keys={COMPACT_SORT_KEYS}
      labels={COMPACT_SORT_LABELS}
      leadingLabel={EXPLORER_LABELS.itemNameColumn}
      onSort={params.onSort}
      sort={params.sort}
      sortLabels={{
        ascending: EXPLORER_LABELS.columnSortedAscending,
        descending: EXPLORER_LABELS.columnSortedDescending,
        menu: EXPLORER_LABELS.itemSortMenuLabel,
        reverse: EXPLORER_LABELS.itemSortReverseAction,
      }}
    />
  );
}
