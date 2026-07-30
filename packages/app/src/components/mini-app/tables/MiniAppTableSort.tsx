import { MiniAppSelectMenu } from "../controls/MiniAppSelectMenu";
import type { MiniAppTableColumn } from "./MiniAppTable";
import "./MiniAppTableSort.css";

type MiniAppTableSortDirection = "asc" | "desc";

export interface MiniAppTableSortState<TKey extends string = string> {
  direction: MiniAppTableSortDirection;
  key: TKey;
}

/**
 * The `aria-sort` a sortable column header carries: its own direction while it
 * is the active key, otherwise "none".
 *
 * A folded table's single summary column stands for several fields at once, so
 * it must declare `"none"` outright rather than call this — announcing one
 * direction there would describe an incomplete sort state.
 */
export function getMiniAppTableSortAria(
  sort: MiniAppTableSortState,
  key: string,
): MiniAppTableColumn["ariaSort"] {
  if (sort.key !== key) {
    return "none";
  }

  return sort.direction === "asc" ? "ascending" : "descending";
}

/**
 * A column header that sorts its table: the label plus an indicator for the
 * active direction. Belongs in the table's own header, which is never
 * virtualized, so on touch it can grow to a full tap target.
 */
export function MiniAppTableSortButton(params: {
  activeDirection: MiniAppTableSortDirection | null;
  label: string;
  onClick: () => void;
}) {
  const { activeDirection, label, onClick } = params;

  return (
    <button
      className="mini-app-table-sort-button"
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <span aria-hidden="true" className="mini-app-table-sort-indicator">
        {activeDirection === "asc"
          ? "^"
          : activeDirection === "desc"
            ? "v"
            : ""}
      </span>
    </button>
  );
}

interface MiniAppCompactSortLabels {
  /** Announced with the active key, e.g. "sorted ascending". */
  ascending: string;
  descending: string;
  /** Names the control itself, e.g. "Sort items". */
  menu: string;
  /** What re-picking the active key does, e.g. "Reverse order". */
  reverse: string;
}

/**
 * The folded counterpart of {@link MiniAppTableSortButton}: a compact table has
 * a single summary column, so its per-column sort buttons have nowhere to live
 * and collapse into one select menu seated in that column's header.
 *
 * `leadingLabel` is the visually-hidden name of the summary column ("Name",
 * "Blob", "Reading"), so the header still reads as that column to a screen
 * reader even though its visible content is the sort control.
 */
export function MiniAppCompactSortMenu<TKey extends string>(params: {
  keys: ReadonlyArray<TKey>;
  labels: Readonly<Record<TKey, string>>;
  leadingLabel: string;
  onSort: (key: TKey) => void;
  sort: MiniAppTableSortState<TKey>;
  sortLabels: MiniAppCompactSortLabels;
}) {
  const { keys, labels, leadingLabel, onSort, sort, sortLabels } = params;
  const stateLabel =
    sort.direction === "asc" ? sortLabels.ascending : sortLabels.descending;
  const directionIndicator = sort.direction === "asc" ? "↑" : "↓";

  return (
    <>
      <span className="mini-app-compact-table-field-label">
        {leadingLabel}:{" "}
      </span>
      <MiniAppSelectMenu
        ariaLabel={`${sortLabels.menu}: ${labels[sort.key]}, ${stateLabel}`}
        className="mini-app-compact-sort-menu"
        onChange={(value) => {
          // The menu hands back a plain string; match it against the caller's
          // own key list rather than asserting the narrowing.
          const key = keys.find((candidate) => candidate === value);
          if (key !== undefined) {
            onSort(key);
          }
        }}
        options={keys.map((key) => ({
          id: key,
          label: labels[key],
          secondaryLabel:
            key === sort.key
              ? `${stateLabel}. ${sortLabels.reverse}`
              : undefined,
          triggerLabel:
            key === sort.key
              ? `${labels[key]} ${directionIndicator}`
              : labels[key],
        }))}
        portaled
        value={sort.key}
      />
    </>
  );
}
