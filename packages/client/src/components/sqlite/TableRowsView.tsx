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

export function TableRowsView({
  tableName,
  backLink,
  containerClassName = DEFAULT_CONTAINER_CLASSNAME,
  showInlineStatus = true,
  onStatusTextChange,
  onExportCsvChange
}: TableRowsViewProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const {
    parentRef,
    columns,
    rows,
    loading,
    loadingMore,
    error,
    hasMore,
    totalCount,
    documentView,
    sort,
    hiddenColumns,
    visibleColumns,
    columnWidths,
    resizingColumn,
    confirmTruncate,
    truncating,
    firstVisible,
    lastVisible,
    virtualItems,
    totalSize,
    measureElement,
    onSort,
    onToggleColumn,
    onToggleDocumentView,
    onTruncateClick,
    onResizeStart,
    onKeyboardResize,
    onRefresh
  } = useTableRowsController({
    tableName,
    isUnlocked,
    isLoading,
    currentInstanceId,
    ...(onStatusTextChange ? { onStatusTextChange } : {}),
    ...(onExportCsvChange ? { onExportCsvChange } : {})
  });

  return (
    <div className={cn(containerClassName)}>
      <TableRowsToolbar
        backLink={backLink}
        tableName={tableName}
        isUnlocked={isUnlocked}
        columns={columns}
        hiddenColumns={hiddenColumns}
        onToggleColumn={onToggleColumn}
        documentView={documentView}
        onToggleDocumentView={onToggleDocumentView}
        confirmTruncate={confirmTruncate}
        onTruncateClick={onTruncateClick}
        truncating={truncating}
        loading={loading}
        onRefresh={onRefresh}
      />

      {!tableName && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
          Select a table to view its data.
        </div>
      )}

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="table data" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isUnlocked && tableName && !error && loading && columns.length === 0 && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
          Loading table data...
        </div>
      )}

      {isUnlocked &&
        tableName &&
        !error &&
        !loading &&
        columns.length === 0 && (
          <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
            Table not found or has no columns
          </div>
        )}

      {isUnlocked && tableName && !error && columns.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          {documentView ? (
            <TableRowsDocumentView
              parentRef={parentRef}
              showInlineStatus={showInlineStatus}
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              rows={rows}
              totalCount={totalCount}
              hasMore={hasMore}
              loading={loading}
              totalSize={totalSize}
              virtualItems={virtualItems}
              measureElement={measureElement}
              getRowKey={(row, index) => getRowKey(row, columns, index)}
              loadingMore={loadingMore}
            />
          ) : (
            <TableRowsTableView
              parentRef={parentRef}
              showInlineStatus={showInlineStatus}
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              rows={rows}
              totalCount={totalCount}
              hasMore={hasMore}
              loading={loading}
              totalSize={totalSize}
              virtualItems={virtualItems}
              measureElement={measureElement}
              visibleColumns={visibleColumns}
              columnWidths={columnWidths}
              sortColumn={sort.column}
              sortDirection={sort.direction}
              onSort={onSort}
              resizingColumn={resizingColumn}
              onResizeStart={onResizeStart}
              onKeyboardResize={onKeyboardResize}
              getRowKey={(row, index) => getRowKey(row, columns, index)}
              formatCellValue={formatCellValue}
              loadingMore={loadingMore}
            />
          )}
        </div>
      )}
    </div>
  );
}
