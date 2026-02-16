import { Braces, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { ColumnSettingsDropdown } from '@/components/sqlite/ColumnSettingsDropdown';
import type { ColumnInfo } from '@/components/sqlite/exportTableCsv';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/RefreshButton';

interface TableRowsToolbarProps {
  backLink?: ReactNode;
  tableName: string | null;
  isUnlocked: boolean;
  columns: ColumnInfo[];
  hiddenColumns: Set<string>;
  onToggleColumn: (columnName: string) => void;
  documentView: boolean;
  onToggleDocumentView: () => void;
  confirmTruncate: boolean;
  onTruncateClick: () => void | Promise<void>;
  truncating: boolean;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
}

export function TableRowsToolbar({
  backLink,
  tableName,
  isUnlocked,
  columns,
  hiddenColumns,
  onToggleColumn,
  documentView,
  onToggleDocumentView,
  confirmTruncate,
  onTruncateClick,
  truncating,
  loading,
  onRefresh
}: TableRowsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-4">
        {backLink}
        <h1 className="font-bold font-mono text-2xl tracking-tight">
          {tableName ?? 'Table'}
        </h1>
      </div>
      {isUnlocked && tableName && (
        <div className="flex flex-wrap items-center gap-2">
          <ColumnSettingsDropdown
            columns={columns}
            hiddenColumns={hiddenColumns}
            onToggleColumn={onToggleColumn}
          />
          <Button
            variant={documentView ? 'default' : 'outline'}
            size="icon"
            onClick={onToggleDocumentView}
            title="Toggle document view"
          >
            <Braces className="h-4 w-4" />
          </Button>
          <Button
            variant={confirmTruncate ? 'destructive' : 'outline'}
            size="sm"
            onClick={onTruncateClick}
            disabled={truncating || loading}
            title={
              confirmTruncate ? 'Click again to confirm' : 'Truncate table'
            }
            data-testid="truncate-button"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {truncating
              ? 'Truncating...'
              : confirmTruncate
                ? 'Confirm'
                : 'Truncate'}
          </Button>
          <RefreshButton onClick={onRefresh} loading={loading} />
        </div>
      )}
    </div>
  );
}
