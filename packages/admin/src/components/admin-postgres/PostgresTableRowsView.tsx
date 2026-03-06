import { useVirtualizer } from '@tanstack/react-virtual';
import { RefreshButton } from '@tearleads/ui';
import { Braces, Download, Loader2, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';
import { createCsv } from '@/lib/csv';
import { DocumentView } from './DocumentView';
import {
  downloadFile,
  isMobileViewport,
  ROW_HEIGHT_ESTIMATE
} from './PostgresTableUtils';
import { StickyVirtualListStatus } from './StickyVirtualListStatus';
import { TableView } from './TableView';
import { usePostgresTableData } from './usePostgresTableData';

const DEFAULT_CONTAINER_CLASSNAME =
  'flex flex-1 min-h-0 flex-col space-y-4 overflow-hidden';

interface PostgresTableRowsViewProps {
  schema: string | null;
  tableName: string | null;
  backLink?: ReactNode;
  containerClassName?: string;
}

export function PostgresTableRowsView({
  schema,
  tableName,
  backLink,
  containerClassName = DEFAULT_CONTAINER_CLASSNAME
}: PostgresTableRowsViewProps) {
  const { t } = useTypedTranslation('admin');
  const {
    columns,
    rows,
    loading,
    loadingMore,
    error,
    hasMore,
    totalCount,
    initialLoadComplete,
    sort,
    handleSort,
    fetchTableData,
    setError
  } = usePostgresTableData(schema, tableName);

  const parentRef = useRef<HTMLDivElement>(null);
  const [documentView, setDocumentView] = useState(isMobileViewport);
  const userToggledViewRef = useRef(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    new Set(['id'])
  );
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);

  // Calculate visible range for sticky status
  const virtualizer = useVirtualizer({
    count: rows.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();

  const visibleRowItems = virtualItems.filter(
    (item) => item.index < rows.length
  );
  const firstVisible =
    visibleRowItems.length > 0 ? (visibleRowItems[0]?.index ?? null) : null;
  const lastVisible =
    visibleRowItems.length > 0
      ? (visibleRowItems[visibleRowItems.length - 1]?.index ?? null)
      : null;

  const stickyStatusElement = (
    <StickyVirtualListStatus
      firstVisible={firstVisible}
      lastVisible={lastVisible}
      loadedCount={rows.length}
      totalCount={totalCount}
      hasMore={hasMore}
    />
  );

  // Close column settings when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(event.target as Node)
      ) {
        setShowColumnSettings(false);
      }
    };

    if (showColumnSettings) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showColumnSettings]);

  // Responsive view toggle
  useEffect(() => {
    if (userToggledViewRef.current) return;

    const handleResize = () => {
      setDocumentView(isMobileViewport());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumns.has(col.name)),
    [columns, hiddenColumns]
  );

  // Load more when scrolling near end
  useEffect(() => {
    if (!initialLoadComplete || !hasMore || loadingMore || loading) return;
    if (!hasScrolled) return;

    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem && lastItem.index >= rows.length - 5 && rows.length > 0) {
      fetchTableData(false);
    }
  }, [
    hasMore,
    loadingMore,
    loading,
    rows.length,
    fetchTableData,
    initialLoadComplete,
    hasScrolled,
    virtualItems
  ]);

  // Track scroll
  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      if (scrollElement.scrollTop > 0) {
        setHasScrolled(true);
      }
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, []);

  const handleToggleColumn = (columnName: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnName)) {
        next.delete(columnName);
      } else {
        next.add(columnName);
      }
      return next;
    });
  };

  const handleToggleView = () => {
    userToggledViewRef.current = true;
    setDocumentView((prev) => !prev);
  };

  const handleExportCsv = useCallback(async () => {
    if (!schema || !tableName || exporting) return;

    setExporting(true);
    try {
      // Fetch all rows for export
      const allRows: Record<string, unknown>[] = [];
      let offset = 0;
      let hasMoreData = true;

      while (hasMoreData) {
        const exportOptions: {
          limit: number;
          offset: number;
          sortColumn?: string;
          sortDirection?: 'asc' | 'desc';
        } = { limit: 1000, offset };
        if (sort.column) exportOptions.sortColumn = sort.column;
        if (sort.direction) exportOptions.sortDirection = sort.direction;

        const response = await api.admin.postgres.getRows(
          schema,
          tableName,
          exportOptions
        );

        allRows.push(...response.rows);

        if (response.rows.length === 0) {
          break;
        }

        offset += response.rows.length;
        hasMoreData = offset < response.totalCount;
      }

      const headers = columns.map((col) => col.name);
      const csvRows = allRows.map((row) =>
        columns.map((col) => {
          const value = row[col.name];
          if (value === null || value === undefined) return '';
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
        })
      );

      const csvContent = createCsv(headers, csvRows);
      downloadFile(csvContent, `${schema}.${tableName}.csv`, 'text/csv');
    } catch (err) {
      console.error('Failed to export CSV:', err);
      setError(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  }, [
    schema,
    tableName,
    columns,
    sort.column,
    sort.direction,
    exporting,
    setError
  ]);

  if (!schema || !tableName) {
    return (
      <div className={containerClassName}>
        {backLink}
        <p className="text-muted-foreground">{t('noTableSelected')}</p>
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      {backLink}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl">{`${schema}.${tableName}`}</h2>
          <p className="text-muted-foreground text-sm">{t('tableBrowser')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExportCsv}
            disabled={exporting || loading || rows.length === 0}
            title={t('exportAsCsv')}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant={documentView ? 'secondary' : 'ghost'}
            size="sm"
            onClick={handleToggleView}
            title={documentView ? t('tableView') : t('documentView')}
          >
            <Braces className="h-4 w-4" />
          </Button>
          <div className="relative" ref={settingsRef}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowColumnSettings(!showColumnSettings)}
              title={t('columnSettings')}
            >
              <Settings className="h-4 w-4" />
            </Button>
            {showColumnSettings && (
              <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border bg-popover p-2 shadow-lg">
                <p className="mb-2 font-medium text-sm">
                  {t('visibleColumns')}
                </p>
                <div className="space-y-1">
                  {columns.map((col) => (
                    <label
                      key={col.name}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.has(col.name)}
                        onChange={() => handleToggleColumn(col.name)}
                        className="h-4 w-4"
                      />
                      <span className="truncate">{col.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <RefreshButton
            onClick={() => fetchTableData(true)}
            loading={loading}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading table data...
        </div>
      ) : rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border p-8 text-muted-foreground">
          No rows found.
        </div>
      ) : documentView ? (
        <DocumentView
          parentRef={parentRef}
          virtualizer={virtualizer}
          rows={rows}
          loadingMore={loadingMore}
          stickyStatus={stickyStatusElement}
        />
      ) : (
        <TableView
          parentRef={parentRef}
          virtualizer={virtualizer}
          rows={rows}
          visibleColumns={visibleColumns}
          sort={sort}
          handleSort={handleSort}
          loadingMore={loadingMore}
          stickyStatus={stickyStatusElement}
        />
      )}
    </div>
  );
}
