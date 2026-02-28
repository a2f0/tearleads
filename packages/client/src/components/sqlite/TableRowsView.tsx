import type { ReactNode } from 'react';
import type { ColumnInfo } from '@/components/sqlite/exportTableCsv';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { TableRowsDocumentView } from '@/components/sqlite/table-rows-view/TableRowsDocumentView';
import { TableRowsTableView } from '@/components/sqlite/table-rows-view/TableRowsTableView';
import { TableRowsToolbar } from '@/components/sqlite/table-rows-view/TableRowsToolbar';
import { useTableRowsController } from '@/components/sqlite/useTableRowsController';
import { useDatabaseContext } from '@/db/hooks';
import { cn } from '@/lib/utils';

const DEFAULT_CONTAINER_CLASSNAME =
  'flex flex-1 min-h-0 flex-col space-y-4 overflow-hidden';

interface TableRowsViewProps {
  tableName: string | null;
  backLink?: ReactNode;
  containerClassName?: string;
  showInlineStatus?: boolean;
  onStatusTextChange?: (text: string) => void;
  onExportCsvChange?: (
    handler: (() => Promise<void>) | null,
    exporting: boolean
  ) => void;
}

type ControllerOptions = {
  tableName: string | null;
  isUnlocked: boolean;
  isLoading: boolean;
  currentInstanceId: string | null;
  onStatusTextChange: ((text: string) => void) | undefined;
  onExportCsvChange:
    | ((
        handler: (() => Promise<void>) | null,
        exporting: boolean
      ) => void)
    | undefined;
};

type ControllerOptionsResult = {
  tableName: string | null;
  isUnlocked: boolean;
  isLoading: boolean;
  currentInstanceId: string | null;
  onStatusTextChange?: (text: string) => void;
  onExportCsvChange?: (
    handler: (() => Promise<void>) | null,
    exporting: boolean
  ) => void;
};

function buildControllerOptions({
  tableName,
  isUnlocked,
  isLoading,
  currentInstanceId,
  onStatusTextChange,
  onExportCsvChange
}: ControllerOptions): ControllerOptionsResult {
  return {
    tableName,
    isUnlocked,
    isLoading,
    currentInstanceId,
    ...(onStatusTextChange ? { onStatusTextChange } : {}),
    ...(onExportCsvChange ? { onExportCsvChange } : {})
  };
}

function formatCellValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getRowKey(
  row: Record<string, unknown>,
  columns: ColumnInfo[],
  index: number
): string {
  const pkColumns = columns.filter((col) => col.pk > 0);
  if (pkColumns.length > 0) {
    return `pk-${pkColumns.map((col) => String(row[col.name])).join('-')}`;
  }
  return `idx-${index}`;
}

type TableRowsController = ReturnType<typeof useTableRowsController>;

type TableRowsBodyState = {
  tableName: string | null;
  isLoading: boolean;
  isUnlocked: boolean;
  error: string | null;
  columns: ColumnInfo[];
};

function renderTableRowsStatus(
  state: TableRowsBodyState,
  loading: boolean
) {
  if (!state.tableName) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
        Select a table to view its data.
      </div>
    );
  }

  if (state.isLoading) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
        Loading database...
      </div>
    );
  }

  if (!state.isUnlocked) {
    return <InlineUnlock description="table data" />;
  }

  if (state.error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
        {state.error}
      </div>
    );
  }

  if (loading && state.columns.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
        Loading table data...
      </div>
    );
  }

  if (state.columns.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
        Table not found or has no columns
      </div>
    );
  }

  return null;
}

function renderTableRowsData(
  controller: TableRowsController,
  columns: ColumnInfo[],
  showInlineStatus: boolean
) {
  if (columns.length === 0 || controller.error) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {controller.documentView ? (
        <TableRowsDocumentView
          parentRef={controller.parentRef}
          showInlineStatus={showInlineStatus}
          firstVisible={controller.firstVisible}
          lastVisible={controller.lastVisible}
          rows={controller.rows}
          totalCount={controller.totalCount}
          hasMore={controller.hasMore}
          loading={controller.loading}
          totalSize={controller.totalSize}
          virtualItems={controller.virtualItems}
          measureElement={controller.measureElement}
          getRowKey={(row, index) => getRowKey(row, columns, index)}
          loadingMore={controller.loadingMore}
        />
      ) : (
        <TableRowsTableView
          parentRef={controller.parentRef}
          showInlineStatus={showInlineStatus}
          firstVisible={controller.firstVisible}
          lastVisible={controller.lastVisible}
          rows={controller.rows}
          totalCount={controller.totalCount}
          hasMore={controller.hasMore}
          loading={controller.loading}
          totalSize={controller.totalSize}
          virtualItems={controller.virtualItems}
          measureElement={controller.measureElement}
          visibleColumns={controller.visibleColumns}
          columnWidths={controller.columnWidths}
          sortColumn={controller.sort.column}
          sortDirection={controller.sort.direction}
          onSort={controller.onSort}
          resizingColumn={controller.resizingColumn}
          onResizeStart={controller.onResizeStart}
          onKeyboardResize={controller.onKeyboardResize}
          getRowKey={(row, index) => getRowKey(row, columns, index)}
          formatCellValue={formatCellValue}
          loadingMore={controller.loadingMore}
        />
      )}
    </div>
  );
}

export function TableRowsView({
  tableName,
  backLink,
  containerClassName = DEFAULT_CONTAINER_CLASSNAME,
  showInlineStatus = true,
  onStatusTextChange,
  onExportCsvChange
}: TableRowsViewProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const controller = useTableRowsController(
    buildControllerOptions({
      tableName,
      isUnlocked,
      isLoading,
      currentInstanceId,
      onStatusTextChange,
      onExportCsvChange
    })
  );

  const statusView = renderTableRowsStatus(
    {
      tableName,
      isLoading,
      isUnlocked,
      error: controller.error,
      columns: controller.columns
    },
    controller.loading
  );

  return (
    <div className={cn(containerClassName)}>
      <TableRowsToolbar
        backLink={backLink}
        tableName={tableName}
        isUnlocked={isUnlocked}
        columns={controller.columns}
        hiddenColumns={controller.hiddenColumns}
        onToggleColumn={controller.onToggleColumn}
        documentView={controller.documentView}
        onToggleDocumentView={controller.onToggleDocumentView}
        confirmTruncate={controller.confirmTruncate}
        onTruncateClick={controller.onTruncateClick}
        truncating={controller.truncating}
        loading={controller.loading}
        onRefresh={controller.onRefresh}
      />

      {statusView}
      {!statusView
        ? renderTableRowsData(controller, controller.columns, showInlineStatus)
        : null}
    </div>
  );
}
