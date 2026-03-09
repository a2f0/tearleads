import { cn } from '../lib/utils.js';

type CountValue = number | bigint;

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

export interface VirtualListStatusProps {
  firstVisible: number | null;
  lastVisible: number | null;
  loadedCount: number;
  totalCount?: CountValue | null;
  hasMore?: boolean;
  itemLabel?: string;
  searchQuery?: string;
  className?: string;
}

function formatCount(value: CountValue): string {
  return typeof value === 'bigint'
    ? value.toLocaleString('en-US')
    : NUMBER_FORMATTER.format(value);
}

function differsFromLoaded(
  totalCount: CountValue,
  loadedCount: number
): boolean {
  return typeof totalCount === 'bigint'
    ? totalCount !== BigInt(loadedCount)
    : totalCount !== loadedCount;
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
  const pluralLabel = loadedCount !== 1 ? `${itemLabel}s` : itemLabel;

  if (loadedCount === 0) {
    return `${formatCount(0)} ${pluralLabel}${searchQuery ? ' found' : ''}`;
  }

  const hasMoreIndicator = hasMore ? '+' : '';

  if (firstVisible != null && lastVisible != null) {
    const rangeText = `Viewing ${formatCount(firstVisible + 1)}-${formatCount(
      lastVisible + 1
    )}`;

    if (totalCount != null && differsFromLoaded(totalCount, loadedCount)) {
      return `${rangeText} (${formatCount(totalCount)} total)`;
    }

    const suffix = searchQuery ? ' found' : '';
    return `${rangeText} of ${formatCount(loadedCount)}${hasMoreIndicator} ${pluralLabel}${suffix}`;
  }

  if (totalCount != null && differsFromLoaded(totalCount, loadedCount)) {
    return `${formatCount(loadedCount)} loaded${hasMoreIndicator} of ${formatCount(
      totalCount
    )} total`;
  }

  return `${formatCount(loadedCount)} ${pluralLabel}${hasMoreIndicator}${searchQuery ? ' found' : ''}`;
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
