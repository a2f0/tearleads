export type ExplorerItemColumnId =
  | "actions"
  | "name"
  | "summary"
  | "type"
  | "created"
  | "modified"
  | "sync";

// Wide-layout column order. Name always leads; Sync is intentionally the
// far-right column, and the two date columns sit adjacent. Keep this in sync
// with the cell renderers in explorerItemTableColumns.tsx.
const WIDE_COLUMN_ORDER: ReadonlyArray<ExplorerItemColumnId> = [
  "name",
  "type",
  "created",
  "modified",
  "sync",
];

// A folded list — a phone, or any pane too narrow for the columns — puts the
// data columns into a single two-line summary column so the name gets the full
// width instead of competing with a date: line one is the name and line two is
// the muted type. A larger leading glyph spans both lines.
// Column-visibility preferences do not apply: the columns menu is off while
// folded, so a wide-layout choice to hide Type would leave a blank second line
// with no way to bring it back.
const COMPACT_COLUMN_ORDER: ReadonlyArray<ExplorerItemColumnId> = ["summary"];

// Columns the user can show/hide. Name is structural and always visible.
export const TOGGLEABLE_COLUMN_IDS: ReadonlyArray<ExplorerItemColumnId> = [
  "type",
  "created",
  "modified",
  "sync",
];

export function getVisibleExplorerItemColumnIds(params: {
  compact: boolean;
  hiddenColumns: ReadonlySet<ExplorerItemColumnId>;
  // Append the trailing actions ("kebab") column. It is the touch stand-in for
  // right-click, so it follows the routed layout rather than the fold: a phone
  // and a touch tablet get it, and a narrow desktop pane does not — that pane
  // still has right-click, and the kebab would eat width exactly where width is
  // scarcest.
  showActions?: boolean | undefined;
}): ReadonlyArray<ExplorerItemColumnId> {
  const { compact, hiddenColumns, showActions = false } = params;
  const columnIds = compact
    ? COMPACT_COLUMN_ORDER
    : WIDE_COLUMN_ORDER.filter((id) => id === "name" || !hiddenColumns.has(id));
  return showActions ? [...columnIds, "actions"] : columnIds;
}
