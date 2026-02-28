import { Button, RefreshButton } from '@tearleads/ui';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { WalletItemSummary } from '../../lib/walletData';
import { useWalletRuntime } from '../../runtime';
import { InlineUnlock } from '../sqlite/InlineUnlock';
import { useWalletTracker } from './useWalletTracker';
import { WalletItemsListContent } from './WalletItemsListContent';

interface WalletItemsListProps {
  onOpenItem: (itemId: string) => void;
  onCreateItem: () => void;
  refreshSignal?: number;
}

export function WalletItemsList({
  onOpenItem,
  onCreateItem,
  refreshSignal = 0
}: WalletItemsListProps) {
  const { isUnlocked } = useWalletRuntime();
  const tracker = useWalletTracker();
  const [items, setItems] = useState<WalletItemSummary[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!tracker) return;
    setLoadingItems(true);
    setError(null);

    try {
      const walletItems = await tracker.listItems();
      setItems(walletItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingItems(false);
    }
  }, [tracker]);

  useEffect(() => {
    if (!isUnlocked) {
      return;
    }

    void fetchItems();
  }, [fetchItems, isUnlocked]);

  useEffect(() => {
    if (!isUnlocked || refreshSignal === 0) {
      return;
    }

    void fetchItems();
  }, [fetchItems, isUnlocked, refreshSignal]);

  if (!isUnlocked) {
    return <InlineUnlock description="this wallet" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </p>
        <div className="flex items-center gap-2">
          <RefreshButton onClick={fetchItems} loading={loadingItems} />
          <Button onClick={onCreateItem} data-testid="wallet-create-item">
            <Plus className="mr-2 h-4 w-4" />
            New Item
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
          {error}
        </div>
      )}

      <div className="rounded-lg border">
        <WalletItemsListContent
          items={items}
          loadingItems={loadingItems}
          onCreateItem={onCreateItem}
          onOpenItem={onOpenItem}
        />
      </div>
    </div>
  );
}
