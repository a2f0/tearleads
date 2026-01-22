import { cn } from '@/lib/utils';

export interface VirtualListStatusProps {
  firstVisible: number | null;
  lastVisible: number | null;
  loadedCount: number;
  totalCount?: number | null;
  hasMore?: boolean;
  itemLabel?: string;
  searchQuery?: string;
  className?: string;
}

export function VirtualListStatus({
  firstVisible,
  lastVisible,
  loadedCount,
  totalCount,
  hasMore = false,
  itemLabel = 'item',
  searchQuery,
  className
}: VirtualListStatusProps) {
  const formatNumber = (value: number) =>
    new Intl.NumberFormat('en-US').format(value);
  const pluralLabel = loadedCount !== 1 ? `${itemLabel}s` : itemLabel;

  const getStatusText = () => {
    // Case 1: No items loaded
    if (loadedCount === 0) {
      return `${formatNumber(0)} ${pluralLabel}${searchQuery ? ' found' : ''}`;
    }

    const hasMoreIndicator = hasMore ? '+' : '';

    // Case 2: We have visible range information
    if (firstVisible != null && lastVisible != null) {
      const rangeText = `Viewing ${formatNumber(firstVisible + 1)}-${formatNumber(
        lastVisible + 1
      )}`;

      // If we have a total count (e.g., from Redis DBSIZE), show loaded vs total
      if (totalCount != null && totalCount !== loadedCount) {
        return `${rangeText} of ${formatNumber(loadedCount)} loaded (${formatNumber(
          totalCount
        )} total)`;
      }

      // Simple case: all data is loaded (no pagination)
      const suffix = searchQuery ? ' found' : '';
      return `${rangeText} of ${formatNumber(loadedCount)}${hasMoreIndicator} ${pluralLabel}${suffix}`;
    }

    // Case 3: No visible range (fallback)
    if (totalCount != null && totalCount !== loadedCount) {
      return `${formatNumber(loadedCount)} loaded${hasMoreIndicator} of ${formatNumber(
        totalCount
      )} total`;
    }

    return `${formatNumber(loadedCount)} ${pluralLabel}${hasMoreIndicator}${searchQuery ? ' found' : ''}`;
  };

  return (
    <p className={cn('text-muted-foreground text-sm', className)}>
      {getStatusText()}
    </p>
  );
}
