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

// Phone-tier explorer folds the data columns into a single two-line summary
// column so the name gets the full width instead of competing with a date: line
// one is the name (with its leading glyph and row button), line two is the muted
// Type + Modified pair. The kebab stays its own trailing column.
// Column-visibility preferences do not apply: the columns menu is off on the
// phone tier, so a desktop choice to hide Type or Modified would leave a blank
// second line with no on-device way to bring it back.
const COMPACT_COLUMN_ORDER: ReadonlyArray<ExplorerItemColumnId> = [
  "summary",
  "actions",
];

// The data columns folded into the compact summary's second line, in order.
export const COMPACT_SUMMARY_SECONDARY_COLUMN_IDS: ReadonlyArray<ExplorerItemColumnId> =
  ["type", "modified"];

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
  // Append the trailing actions ("kebab") column on the wide layout. The phone
  // tier already carries `actions` in its fixed set, so this only matters for
  // the tablet/iPad touch layout, where the wide columns stay but the kebab is
  // the touch stand-in for right-click. Desktop leaves it off.
  showActions?: boolean | undefined;
}): ReadonlyArray<ExplorerItemColumnId> {
  const { compact, hiddenColumns, showActions = false } = params;
  if (compact) {
    return COMPACT_COLUMN_ORDER;
  }

  const wide = WIDE_COLUMN_ORDER.filter(
    (id) => id === "name" || !hiddenColumns.has(id),
  );
  return showActions ? [...wide, "actions"] : wide;
}
