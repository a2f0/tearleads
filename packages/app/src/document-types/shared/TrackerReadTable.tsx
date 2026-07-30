import { type ReactNode, useMemo, useState } from "react";
import {
  getMiniAppTableSortAria,
  MiniAppColumnMenuButton,
  MiniAppCompactSortMenu,
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableSortButton,
  type MiniAppTableSortState,
  MiniAppTableText,
  miniAppRowActionsColumn,
  useMiniAppColumnVisibility,
  useMiniAppCompactTableFrame,
} from "../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../components/shared/classNames";
import "./TrackerReadTable.css";

/** One column's value for one row, in both of its presentations. */
export interface TrackerReadCell {
  /**
   * This row has no value this column can rank — an unset cell showing a
   * placeholder ("None", "—"), or one holding something the document itself
   * would reject ("180abc"). Set it wherever either is produced: it is what keeps
   * the row at the bottom of a sort by this column in *both* directions (see
   * {@link orderTrackerRows}). A column that ranks values its comparator cannot
   * order, without saying so here, gets those rows lifted to the top when the
   * header is reversed.
   */
  unranked?: boolean | undefined;
  /**
   * Markup for values that are not plain text — the .env value and its
   * reveal/copy controls. Rendered in place of `text`, which is still required:
   * it is what the folded row announces the column by, and what a caller
   * without any markup to add supplies on its own.
   */
  content?: ReactNode | undefined;
  text: string;
  title?: string | undefined;
}

export interface TrackerReadColumn<TRow> {
  cell: (row: TRow) => TrackerReadCell;
  /** Ascending order for this column. Omit to make the column unsortable. */
  compare?: ((left: TRow, right: TRow) => number) | undefined;
  className?: string | undefined;
  /**
   * Which line of a folded (narrow-frame) row this column joins, or "none" to
   * drop it from the fold — where there is only room for the values a phone
   * reader actually scans, the ordinal being the standing example.
   */
  fold: "primary" | "secondary" | "none";
  header: string;
  /**
   * Whether the column can be switched off from the table's columns menu, and
   * whether it starts off. A tracker keeps exactly one column with no `width` to
   * absorb the table's slack, and that column must NOT be hideable: with every
   * column measured, a fixed table layout takes the sum of those widths as its
   * own width instead of shrinking them, which pushes the trailing kebab out of
   * the frame and into horizontal scroll.
   */
  hideable?: boolean | undefined;
  defaultHidden?: boolean | undefined;
  id: string;
  /** Values that are data rather than prose: measurements, keys, timestamps. */
  monospace?: boolean | undefined;
  /** Supporting values (notes, attribution) that should not compete with data. */
  muted?: boolean | undefined;
  /**
   * Names this column in the folded sort menu, where a bare symbol like "#" has
   * no surrounding column to explain it. Defaults to `header`.
   */
  sortLabel?: string | undefined;
  width?: string | undefined;
}

const TRACKER_SORT_LABELS = {
  ascending: "sorted ascending",
  descending: "sorted descending",
  reverse: "Reverse order",
} as const;

function orderTrackerRows<TRow>(
  rows: ReadonlyArray<TRow>,
  columns: ReadonlyArray<TrackerReadColumn<TRow>>,
  sort: MiniAppTableSortState,
): ReadonlyArray<TRow> {
  const column = columns.find((candidate) => candidate.id === sort.key);
  const compare = column?.compare;
  if (!column || !compare) {
    return rows;
  }

  // "Nothing here to rank" is not a value to be ordered among the others, so it
  // is settled before the comparator runs and stays put in both directions.
  // Leaving it to the comparator would lift every such row to the top of a
  // descending sort — the opposite of what sorting by a column means to a reader,
  // who wants the rows that *have* this value first either way. Resolved once per
  // row rather than per comparison, and from the same cell the table draws, so it
  // cannot disagree with what is on screen.
  const unranked = new Map(
    rows.map((row) => [row, column.cell(row).unranked === true] as const),
  );
  // Inverting the comparator rather than reversing the sorted array keeps the
  // sort stable in both directions: rows the column cannot tell apart hold
  // their document order instead of flipping with the header.
  return [...rows].sort((left, right) => {
    const leftUnranked = unranked.get(left) ?? false;
    if (leftUnranked !== (unranked.get(right) ?? false)) {
      return leftUnranked ? 1 : -1;
    }

    return sort.direction === "asc"
      ? compare(left, right)
      : compare(right, left);
  });
}

function toFoldedFields<TRow>(
  columns: ReadonlyArray<TrackerReadColumn<TRow>>,
  row: TRow,
  line: "primary" | "secondary",
): ReadonlyArray<MiniAppCompactTableField> {
  return columns
    .filter((column) => column.fold === line)
    .map((column) => {
      const cell = column.cell(row);
      return {
        id: column.id,
        label: column.header,
        text: cell.text,
        ...(cell.content === undefined ? {} : { content: cell.content }),
        ...(cell.title === undefined ? {} : { title: cell.title }),
      };
    });
}

function buildTrackerReadTableColumns<TRow>(params: {
  actionsLabel: string;
  columnMenu: ReactNode;
  columns: ReadonlyArray<TrackerReadColumn<TRow>>;
  compact: boolean;
  onSort: (columnId: string) => void;
  sortMenuLabel: string;
  sort: MiniAppTableSortState;
}): ReadonlyArray<MiniAppTableColumn> {
  const {
    actionsLabel,
    columnMenu,
    columns,
    compact,
    onSort,
    sortMenuLabel,
    sort,
  } = params;
  // The kebab is the table's trailing edge, so the columns trigger rides in its
  // header to stay flush right rather than one narrow column in from it.
  const actionsColumn = miniAppRowActionsColumn(actionsLabel, columnMenu);
  if (!compact) {
    return [
      ...columns.map((column) => ({
        ariaSort: column.compare
          ? getMiniAppTableSortAria(sort, column.id)
          : undefined,
        className: column.className,
        header: column.compare ? (
          <MiniAppTableSortButton
            activeDirection={sort.key === column.id ? sort.direction : null}
            label={column.header}
            onClick={() => onSort(column.id)}
          />
        ) : (
          column.header
        ),
        id: column.id,
        width: column.width,
      })),
      actionsColumn,
    ];
  }

  const sortableColumns = columns.filter((column) => column.compare);
  return [
    {
      // The folded cell below stands for every visible column, so announcing one
      // column's direction on this <th> would describe an incomplete sort state.
      // The menu inside it names both the active field and its direction.
      ariaSort: "none",
      header: (
        <MiniAppCompactSortMenu
          keys={sortableColumns.map((column) => column.id)}
          labels={Object.fromEntries(
            sortableColumns.map((column) => [
              column.id,
              column.sortLabel ?? column.header,
            ]),
          )}
          leadingLabel={
            columns.find((column) => column.fold === "primary")?.header ??
            actionsLabel
          }
          onSort={onSort}
          sort={sort}
          sortLabels={{ ...TRACKER_SORT_LABELS, menu: sortMenuLabel }}
        />
      ),
      id: "summary",
    },
    actionsColumn,
  ];
}

/**
 * Which columns the table draws, plus the menu that switches the hideable ones
 * on and off (persisted per tracker). A folded table shows one summary column, so
 * it has nothing to switch and gets no menu.
 */
function useTrackerColumnVisibility<TRow>(params: {
  columnStorageKey: string;
  columns: ReadonlyArray<TrackerReadColumn<TRow>>;
  compact: boolean;
}): {
  columnMenu: ReactNode;
  visibleColumns: ReadonlyArray<TrackerReadColumn<TRow>>;
} {
  const { columnStorageKey, columns, compact } = params;
  const hideableColumns = useMemo(
    () => columns.filter((column) => column.hideable),
    [columns],
  );
  const defaultHiddenColumnIds = useMemo(
    () =>
      hideableColumns
        .filter((column) => column.defaultHidden)
        .map((column) => column.id),
    [hideableColumns],
  );
  const toggleableColumnIds = useMemo(
    () => hideableColumns.map((column) => column.id),
    [hideableColumns],
  );
  const { hiddenColumns, toggleColumn } = useMiniAppColumnVisibility({
    defaultHiddenColumnIds,
    storageKey: columnStorageKey,
    toggleableColumnIds,
  });

  return {
    columnMenu:
      compact || hideableColumns.length === 0 ? null : (
        <MiniAppColumnMenuButton
          ariaLabel="Columns"
          hiddenColumns={hiddenColumns}
          options={hideableColumns.map((column) => ({
            id: column.id,
            label: column.header,
          }))}
          stateLabels={{ off: "Off", on: "On" }}
          toggleColumn={toggleColumn}
        />
      ),
    visibleColumns: columns.filter((column) => !hiddenColumns.has(column.id)),
  };
}

function TrackerReadTableRow<TRow>(params: {
  actions: ReactNode;
  columns: ReadonlyArray<TrackerReadColumn<TRow>>;
  compact: boolean;
  row: TRow;
}) {
  const { actions, columns, compact, row } = params;

  return (
    <MiniAppTableRow className="tracker-read-table-row">
      {compact ? (
        <MiniAppCompactTableCell
          primary={toFoldedFields(columns, row, "primary")}
          secondary={toFoldedFields(columns, row, "secondary")}
        />
      ) : (
        columns.map((column) => {
          const cell = column.cell(row);
          return (
            <MiniAppTableCell className={column.className} key={column.id}>
              {cell.content ?? (
                <MiniAppTableText
                  className={
                    column.monospace ? "tracker-read-table-value" : undefined
                  }
                  muted={column.muted}
                  title={cell.title}
                >
                  {cell.text}
                </MiniAppTableText>
              )}
            </MiniAppTableCell>
          );
        })
      )}
      <MiniAppTableCell className="mini-app-row-actions-cell">
        {actions}
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

/**
 * The index (list) view every tracker document type presents in read mode: one
 * table, one set of sortable column headers, and a trailing kebab per row —
 * deliberately the same shape as the Explorer's container listing, so a reading
 * of many entries is scanned rather than read card by card.
 *
 * Sort state is the table's own: it orders what it was handed for display only,
 * and never writes back to the document. `rows` therefore arrive in document
 * order, which is also what the ordinal column reports, so re-sorting the table
 * cannot renumber an entry out from under the controls named after it.
 *
 * A frame too narrow for the columns — a phone, or a windowed pane dragged in —
 * folds every column into one two-line summary, exactly as the shared list
 * tables do; the per-column sort buttons become one select menu in its header.
 *
 * Columns a tracker marks hideable get the shared columns menu in the kebab
 * header, so a pane too tight for every column is the reader's to trim rather
 * than something they have to scroll sideways through.
 */
export function TrackerReadTable<TRow>(params: {
  /** The sr-only heading of the trailing kebab column. */
  actionsLabel: string;
  ariaLabel: string;
  /** Where this tracker remembers which columns the reader switched off. */
  columnStorageKey: string;
  columns: ReadonlyArray<TrackerReadColumn<TRow>>;
  defaultSortColumnId: string;
  emptyLabel: string;
  renderActions: (row: TRow) => ReactNode;
  rowKey: (row: TRow) => string;
  rows: ReadonlyArray<TRow>;
  sortMenuLabel: string;
}) {
  const {
    actionsLabel,
    ariaLabel,
    columnStorageKey,
    columns,
    defaultSortColumnId,
    emptyLabel,
    renderActions,
    rowKey,
    rows,
    sortMenuLabel,
  } = params;
  const { compact, frameRef, rowHeight } = useMiniAppCompactTableFrame();
  const [sort, setSort] = useState<MiniAppTableSortState>({
    direction: "asc",
    key: defaultSortColumnId,
  });
  const { columnMenu, visibleColumns } = useTrackerColumnVisibility({
    columnStorageKey,
    columns,
    compact,
  });
  // A folded table has one summary column and no columns menu, so switching a
  // column off is a wide-table preference that does not apply to it. Folding on
  // the full set is also what keeps the sort honest: were the folded sort menu
  // built from the visible columns, sorting by a column and then hiding it would
  // leave `sort.key` with no matching option — a blank trigger whose accessible
  // name read "undefined".
  const displayColumns = compact ? columns : visibleColumns;
  // Switching off the column a table is sorted by would otherwise leave the rows
  // reordered by a value that is no longer on screen, with no header left to
  // carry the indicator explaining it. Fall back to the default column while that
  // is the case — the rows and the visible indicator then always agree — and keep
  // the chosen sort in state, so re-showing the column restores it rather than
  // making the reader pick it again.
  const effectiveSort = displayColumns.some(
    (column) => column.id === sort.key && column.compare,
  )
    ? sort
    : { direction: "asc" as const, key: defaultSortColumnId };
  const orderedRows = useMemo(
    () => orderTrackerRows(rows, displayColumns, effectiveSort),
    [displayColumns, effectiveSort, rows],
  );
  const tableColumns = buildTrackerReadTableColumns({
    actionsLabel,
    columnMenu,
    columns: displayColumns,
    compact,
    onSort: (columnId) =>
      setSort((current) =>
        current.key === columnId
          ? {
              direction: current.direction === "asc" ? "desc" : "asc",
              key: columnId,
            }
          : { direction: "asc", key: columnId },
      ),
    sort: effectiveSort,
    sortMenuLabel,
  });

  return (
    <MiniAppTableFrame
      className={classNames(
        "tracker-read-table",
        "mini-app-table-frame--compact",
        // Folded rows take the taller pitch; the shared modifier restores it over
        // the routed 44px row floor.
        compact && "mini-app-table-frame--two-line",
      )}
      ref={frameRef}
      style={getMiniAppVirtualFrameStyle(rowHeight)}
    >
      <MiniAppTable aria-label={ariaLabel} columns={tableColumns}>
        {orderedRows.length === 0 ? (
          <MiniAppTableEmptyRow colSpan={tableColumns.length}>
            {emptyLabel}
          </MiniAppTableEmptyRow>
        ) : (
          orderedRows.map((row) => (
            <TrackerReadTableRow
              key={rowKey(row)}
              actions={renderActions(row)}
              columns={displayColumns}
              compact={compact}
              row={row}
            />
          ))
        )}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
