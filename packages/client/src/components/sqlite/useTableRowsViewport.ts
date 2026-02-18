import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getVirtualListStatusText } from '@/components/ui/VirtualListStatus';
import type { ColumnInfo } from './exportTableCsv';

interface UseTableRowsViewportArgs {
  parentRef: React.RefObject<HTMLDivElement | null>;
  columns: ColumnInfo[];
  hiddenColumns: Set<string>;
  rows: Record<string, unknown>[];
  hasMore: boolean;
  totalCount: number | null;
  loading: boolean;
  loadingMore: boolean;
  tableName: string | null;
  isLoading: boolean;
  isUnlocked: boolean;
  error: string | null;
  initialLoadComplete: boolean;
  documentView: boolean;
  onStatusTextChange?: (text: string) => void;
  onFetchMore: () => void;
}

interface UseTableRowsViewportResult {
  visibleColumns: ColumnInfo[];
  firstVisible: number | null;
  lastVisible: number | null;
  virtualItems: ReturnType<
    ReturnType<typeof useVirtualizer>['getVirtualItems']
  >;
  totalSize: number;
  measureElement: (element: HTMLDivElement | null) => void;
}

const ROW_HEIGHT_ESTIMATE = 40;

export function useTableRowsViewport({
  parentRef,
  columns,
  hiddenColumns,
  rows,
  hasMore,
  totalCount,
  loading,
  loadingMore,
  tableName,
  isLoading,
  isUnlocked,
  error,
  initialLoadComplete,
  documentView,
  onStatusTextChange,
  onFetchMore
}: UseTableRowsViewportArgs): UseTableRowsViewportResult {
  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumns.has(col.name)),
    [columns, hiddenColumns]
  );

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

  useEffect(() => {
    if (!onStatusTextChange) return;

    if (!tableName) {
      onStatusTextChange('Select a table to view its data.');
      return;
    }

    if (isLoading) {
      onStatusTextChange('Loading database...');
      return;
    }

    if (!isUnlocked) {
      onStatusTextChange('Database locked');
      return;
    }

    if (error) {
      onStatusTextChange(error);
      return;
    }

    if (loading && columns.length === 0) {
      onStatusTextChange('Loading table data...');
      return;
    }

    if (columns.length === 0) {
      onStatusTextChange('Table not found or has no columns');
      return;
    }

    onStatusTextChange(
      getVirtualListStatusText({
        firstVisible,
        lastVisible,
        loadedCount: rows.length,
        totalCount,
        hasMore,
        itemLabel: 'row'
      })
    );
  }, [
    columns.length,
    error,
    firstVisible,
    hasMore,
    isLoading,
    isUnlocked,
    lastVisible,
    loading,
    onStatusTextChange,
    rows.length,
    tableName,
    totalCount
  ]);

  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    if (!tableName) {
      setHasScrolled(false);
      return;
    }
    setHasScrolled(false);
  }, [tableName]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: documentView triggers re-run when scroll container changes
  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      setHasScrolled(true);
    };

    scrollElement.addEventListener('scroll', handleScroll, {
      once: true,
      passive: true
    });
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, [columns.length, documentView, parentRef, tableName]);

  const fetchMoreRef = useRef(onFetchMore);
  fetchMoreRef.current = onFetchMore;

  useEffect(() => {
    if (!initialLoadComplete) return;
    if (!hasScrolled) return;
    if (!hasMore || loadingMore || loading || virtualItems.length === 0) return;

    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem && lastItem.index >= rows.length - 5) {
      fetchMoreRef.current();
    }
  }, [
    hasMore,
    hasScrolled,
    initialLoadComplete,
    loading,
    loadingMore,
    rows.length,
    virtualItems
  ]);

  return {
    visibleColumns,
    firstVisible,
    lastVisible,
    virtualItems,
    totalSize: virtualizer.getTotalSize(),
    measureElement: (element) => virtualizer.measureElement(element)
  };
}
