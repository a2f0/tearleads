import { VirtualListStatus } from '@tearleads/ui';

interface StickyVirtualListStatusProps {
  firstVisible: number | null;
  lastVisible: number | null;
  loadedCount: number;
  totalCount: number | null;
  hasMore: boolean;
}

export function StickyVirtualListStatus({
  firstVisible,
  lastVisible,
  loadedCount,
  totalCount,
  hasMore
}: StickyVirtualListStatusProps) {
  return (
    <div className="sticky top-0 z-10 bg-background px-4 py-2">
      <VirtualListStatus
        firstVisible={firstVisible}
        lastVisible={lastVisible}
        loadedCount={loadedCount}
        totalCount={totalCount}
        hasMore={hasMore}
        itemLabel="row"
      />
    </div>
  );
}
