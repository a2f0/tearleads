import { useMemo } from "react";
import {
  addMiniAppTableHeaderAction,
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppCompactTableHeader,
  type MiniAppTableColumn,
  miniAppRowActionsColumn,
  useMiniAppColumnVisibility,
} from "../../components/mini-app/MiniAppTable";
import { ORG_MANAGER_LABELS } from "./labels";

interface OrgManagerTableColumnsConfig<ColumnId extends string> {
  allColumnIds: ReadonlyArray<ColumnId>;
  columnLabels: Readonly<Record<ColumnId, string>>;
  dataColumns: ReadonlyArray<MiniAppTableColumn & { id: ColumnId }>;
  menuOptions: ReadonlyArray<MiniAppColumnMenuOption<ColumnId>>;
  storageKey: string;
  toggleableColumnIds: ReadonlyArray<ColumnId>;
}

// Shared column assembly for the Directory and Group tables: persisted column
// visibility, a single summary column on compact (touch) layouts, and the
// kebab/actions column when row actions are shown.
export function useOrgManagerTableColumns<ColumnId extends string>(
  config: OrgManagerTableColumnsConfig<ColumnId>,
  showActions: boolean,
  compact: boolean,
): {
  columns: ReadonlyArray<MiniAppTableColumn>;
  visibleColumnIds: ReadonlyArray<ColumnId>;
} {
  const {
    allColumnIds,
    columnLabels,
    dataColumns: dataColumnDefs,
    menuOptions,
    storageKey,
    toggleableColumnIds,
  } = config;
  const columnVisibility = useMiniAppColumnVisibility<ColumnId>({
    storageKey,
    toggleableColumnIds,
  });
  const visibleColumnIds = useMemo(
    () =>
      getVisibleMiniAppTableColumnIds(
        allColumnIds,
        columnVisibility.hiddenColumns,
      ),
    [allColumnIds, columnVisibility.hiddenColumns],
  );
  const columns = useMemo(() => {
    const columnMenu = (
      <MiniAppColumnMenuButton
        ariaLabel={ORG_MANAGER_LABELS.columns}
        hiddenColumns={columnVisibility.hiddenColumns}
        options={menuOptions}
        stateLabels={{
          off: ORG_MANAGER_LABELS.columnsMenuStateOff,
          on: ORG_MANAGER_LABELS.columnsMenuStateOn,
        }}
        toggleColumn={columnVisibility.toggleColumn}
      />
    );
    const dataColumns = dataColumnDefs.filter(
      (column) => !columnVisibility.hiddenColumns.has(column.id),
    );
    if (compact) {
      const compactColumn = {
        header: (
          <MiniAppCompactTableHeader
            primary={visibleColumnIds.slice(0, 1).map((id) => ({
              id,
              text: columnLabels[id],
            }))}
            secondary={visibleColumnIds.slice(1).map((id) => ({
              id,
              text: columnLabels[id],
            }))}
          />
        ),
        id: "summary",
      } satisfies MiniAppTableColumn;

      return showActions
        ? [
            compactColumn,
            miniAppRowActionsColumn(
              ORG_MANAGER_LABELS.rowActionsColumn,
              columnMenu,
            ),
          ]
        : addMiniAppTableHeaderAction([compactColumn], columnMenu);
    }
    // When the touch kebab column trails the table it is the trailing edge, so
    // the column-menu trigger rides in its header to stay flush right — on the
    // last data column it would sit one narrow column in from the edge.
    return showActions
      ? [
          ...dataColumns,
          miniAppRowActionsColumn(
            ORG_MANAGER_LABELS.rowActionsColumn,
            columnMenu,
          ),
        ]
      : addMiniAppTableHeaderAction(dataColumns, columnMenu);
  }, [
    columnLabels,
    compact,
    columnVisibility.hiddenColumns,
    columnVisibility.toggleColumn,
    dataColumnDefs,
    menuOptions,
    showActions,
    visibleColumnIds,
  ]);

  return { columns, visibleColumnIds };
}
