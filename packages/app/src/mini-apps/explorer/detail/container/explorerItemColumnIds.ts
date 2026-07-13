export type ExplorerItemColumnId =
  | "actions"
  | "name"
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

// Phone-tier explorer keeps a trimmed, fixed set so the file name leads and the
// row fits without a horizontal scroll. Column-visibility preferences do not
// apply here.
const COMPACT_COLUMN_ORDER: ReadonlyArray<ExplorerItemColumnId> = [
  "name",
  "type",
  "modified",
  "actions",
];

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
