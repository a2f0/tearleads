import { type ReactNode, useMemo } from "react";
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
  // Trailing action column appended when row actions are hidden (the touch
  // kebab replaces it when actions are shown).
  actionColumn?: MiniAppTableColumn;
  allColumnIds: ReadonlyArray<ColumnId>;
  columnLabels: Readonly<Record<ColumnId, string>>;
  // Explicit compact summary lines; defaults to first-visible / rest.
  compactPrimaryColumnIds?: ReadonlyArray<ColumnId>;
  compactSecondaryColumnIds?: ReadonlyArray<ColumnId>;
  dataColumns: ReadonlyArray<MiniAppTableColumn & { id: ColumnId }>;
  menuOptions: ReadonlyArray<MiniAppColumnMenuOption<ColumnId>>;
  storageKey: string;
  toggleableColumnIds: ReadonlyArray<ColumnId>;
}

function compactSummaryColumn<ColumnId extends string>(
  config: OrgManagerTableColumnsConfig<ColumnId>,
  visibleColumnIds: ReadonlyArray<ColumnId>,
): MiniAppTableColumn {
  const { columnLabels, compactPrimaryColumnIds, compactSecondaryColumnIds } =
    config;
  const primaryIds =
    compactPrimaryColumnIds?.filter((id) => visibleColumnIds.includes(id)) ??
    visibleColumnIds.slice(0, 1);
  const secondaryIds =
    compactSecondaryColumnIds?.filter((id) => visibleColumnIds.includes(id)) ??
    visibleColumnIds.slice(1);

  return {
    header: (
      <MiniAppCompactTableHeader
        primary={primaryIds.map((id) => ({ id, text: columnLabels[id] }))}
        secondary={secondaryIds.map((id) => ({ id, text: columnLabels[id] }))}
      />
    ),
    id: "summary",
  };
}

function buildOrgManagerTableColumns<ColumnId extends string>(input: {
  columnMenu: ReactNode;
  compact: boolean;
  config: OrgManagerTableColumnsConfig<ColumnId>;
  hiddenColumns: ReadonlySet<ColumnId>;
  showActions: boolean;
  visibleColumnIds: ReadonlyArray<ColumnId>;
}): ReadonlyArray<MiniAppTableColumn> {
  const { columnMenu, compact, config, hiddenColumns, showActions } = input;
  const leadingColumns = compact
    ? [compactSummaryColumn(config, input.visibleColumnIds)]
    : config.dataColumns.filter((column) => !hiddenColumns.has(column.id));
  if (showActions) {
    // When the touch kebab column trails the table it is the trailing edge, so
    // the column-menu trigger rides in its header to stay flush right — on the
    // last data column it would sit one narrow column in from the edge.
    return [
      ...leadingColumns,
      miniAppRowActionsColumn(ORG_MANAGER_LABELS.rowActionsColumn, columnMenu),
    ];
  }

  return addMiniAppTableHeaderAction(
    config.actionColumn
      ? [...leadingColumns, config.actionColumn]
      : leadingColumns,
    columnMenu,
  );
}

// Shared column assembly for the org-manager tables: persisted column
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
  const columnVisibility = useMiniAppColumnVisibility<ColumnId>({
    storageKey: config.storageKey,
    toggleableColumnIds: config.toggleableColumnIds,
  });
  const visibleColumnIds = useMemo(
    () =>
      getVisibleMiniAppTableColumnIds(
        config.allColumnIds,
        columnVisibility.hiddenColumns,
      ),
    [config.allColumnIds, columnVisibility.hiddenColumns],
  );
  const columns = useMemo(
    () =>
      buildOrgManagerTableColumns({
        columnMenu: (
          <MiniAppColumnMenuButton
            ariaLabel={ORG_MANAGER_LABELS.columns}
            hiddenColumns={columnVisibility.hiddenColumns}
            options={config.menuOptions}
            stateLabels={{
              off: ORG_MANAGER_LABELS.columnsMenuStateOff,
              on: ORG_MANAGER_LABELS.columnsMenuStateOn,
            }}
            toggleColumn={columnVisibility.toggleColumn}
          />
        ),
        compact,
        config,
        hiddenColumns: columnVisibility.hiddenColumns,
        showActions,
        visibleColumnIds,
      }),
    [
      compact,
      config,
      columnVisibility.hiddenColumns,
      columnVisibility.toggleColumn,
      showActions,
      visibleColumnIds,
    ],
  );

  return { columns, visibleColumnIds };
}
