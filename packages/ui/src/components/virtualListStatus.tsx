import { cn } from '../lib/utils.js';

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

export function getVirtualListStatusText({
  firstVisible,
  lastVisible,
  loadedCount,
  totalCount,
  hasMore = false,
  itemLabel = 'item',
  searchQuery
}: Omit<VirtualListStatusProps, 'className'>): string {
  const formatNumber = new Intl.NumberFormat('en-US').format;
  const pluralLabel = loadedCount !== 1 ? `${itemLabel}s` : itemLabel;

  if (loadedCount === 0) {
    return `${formatNumber(0)} ${pluralLabel}${searchQuery ? ' found' : ''}`;
  }

  const hasMoreIndicator = hasMore ? '+' : '';

  if (firstVisible != null && lastVisible != null) {
    const rangeText = `Viewing ${formatNumber(firstVisible + 1)}-${formatNumber(
      lastVisible + 1
    )}`;

    if (totalCount != null && totalCount !== loadedCount) {
      return `${rangeText} (${formatNumber(totalCount)} total)`;
    }

    const suffix = searchQuery ? ' found' : '';
    return `${rangeText} of ${formatNumber(loadedCount)}${hasMoreIndicator} ${pluralLabel}${suffix}`;
  }

  if (totalCount != null && totalCount !== loadedCount) {
    return `${formatNumber(loadedCount)} loaded${hasMoreIndicator} of ${formatNumber(
      totalCount
    )} total`;
  }

  return `${formatNumber(loadedCount)} ${pluralLabel}${hasMoreIndicator}${searchQuery ? ' found' : ''}`;
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
  return (
    <p className={cn('text-muted-foreground text-sm', className)}>
      {getVirtualListStatusText({
        firstVisible,
        lastVisible,
        loadedCount,
        ...(totalCount !== undefined && { totalCount }),
        hasMore,
        itemLabel,
        ...(searchQuery !== undefined && { searchQuery })
      })}
    </p>
  );
}
