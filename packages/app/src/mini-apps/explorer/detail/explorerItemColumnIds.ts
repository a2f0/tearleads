export type ExplorerItemColumnId =
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
];

// Columns the user can show/hide. Name is structural and always visible.
export const TOGGLEABLE_COLUMN_IDS: ReadonlyArray<ExplorerItemColumnId> = [
  "type",
  "created",
  "modified",
  "sync",
];

export function isToggleableExplorerItemColumnId(
  value: unknown,
): value is ExplorerItemColumnId {
  return (
    typeof value === "string" &&
    TOGGLEABLE_COLUMN_IDS.some((columnId) => columnId === value)
  );
}

export function getVisibleExplorerItemColumnIds(params: {
  compact: boolean;
  hiddenColumns: ReadonlySet<ExplorerItemColumnId>;
}): ReadonlyArray<ExplorerItemColumnId> {
  const { compact, hiddenColumns } = params;
  if (compact) {
    return COMPACT_COLUMN_ORDER;
  }

  return WIDE_COLUMN_ORDER.filter(
    (id) => id === "name" || !hiddenColumns.has(id),
  );
}
