import type {
  ContainerItemSort,
  ContainerItemSortKey,
} from "@tearleads/client-sdk";
import { MiniAppSelectMenu } from "../../../components/mini-app/controls/MiniAppSelectMenu";
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

function isContainerItemSortKey(value: string): value is ContainerItemSortKey {
  return COMPACT_SORT_KEYS.some((key) => key === value);
}

export function ExplorerCompactSortHeader(params: {
  onSort: (key: ContainerItemSortKey) => void;
  sort: ContainerItemSort;
}) {
  const { onSort, sort } = params;
  const stateLabel =
    sort.direction === "asc"
      ? EXPLORER_LABELS.columnSortedAscending
      : EXPLORER_LABELS.columnSortedDescending;
  const directionIndicator = sort.direction === "asc" ? "↑" : "↓";

  return (
    <>
      <span className="explorer-item-summary-field-label">
        {EXPLORER_LABELS.itemNameColumn}:{" "}
      </span>
      <MiniAppSelectMenu
        ariaLabel={`${EXPLORER_LABELS.itemSortMenuLabel}: ${COMPACT_SORT_LABELS[sort.key]}, ${stateLabel}`}
        className="explorer-compact-sort-menu"
        onChange={(value) => {
          if (isContainerItemSortKey(value)) {
            onSort(value);
          }
        }}
        options={COMPACT_SORT_KEYS.map((key) => ({
          id: key,
          label: COMPACT_SORT_LABELS[key],
          secondaryLabel:
            key === sort.key
              ? `${stateLabel}. ${EXPLORER_LABELS.itemSortReverseAction}`
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
