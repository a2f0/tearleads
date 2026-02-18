import { Button, RefreshButton } from '@tearleads/ui';
import { CreditCard, Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  getWalletItemTypeLabel,
  listWalletItems,
  type WalletItemSummary
} from '../../lib/walletData';
import { getWalletSubtypeLabel } from '../../lib/walletSubtypes';
import { getWalletUiDependencies } from '../../lib/walletUiDependencies';

interface WalletItemsListProps {
  onOpenItem: (itemId: string) => void;
  onCreateItem: () => void;
  refreshSignal?: number;
}

function formatExpiryDate(expiresOn: Date | null): string {
  if (!expiresOn) {
    return 'No expiry date';
  }
  return expiresOn.toLocaleDateString();
}

export function WalletItemsList({
  onOpenItem,
  onCreateItem,
  refreshSignal = 0
}: WalletItemsListProps) {
  const dependencies = getWalletUiDependencies();
  const databaseContext = dependencies?.useDatabaseContext();
  const isLoading = databaseContext?.isLoading ?? false;
  const isUnlocked = databaseContext?.isUnlocked ?? false;
  const InlineUnlock = dependencies?.InlineUnlock;
  const [items, setItems] = useState<WalletItemSummary[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoadingItems(true);
    setError(null);

    try {
      const walletItems = await listWalletItems();
      setItems(walletItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingItems(false);
    }
  }, []);

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

  if (isLoading) {
    return (
      <div className="rounded-lg border p-6 text-center text-muted-foreground">
        Loading database...
      </div>
    );
  }

  if (!isUnlocked) {
    if (!InlineUnlock) {
      return (
        <div className="rounded-lg border p-6 text-center text-muted-foreground">
          Wallet is not configured.
        </div>
      );
    }
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
        {loadingItems && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading wallet items...
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
            <CreditCard className="h-8 w-8" />
            <p>No wallet items yet.</p>
            <Button variant="outline" onClick={onCreateItem}>
              <Plus className="mr-2 h-4 w-4" />
              Add your first item
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full px-4 py-3 text-left transition-colors hover:bg-muted/50"
                onClick={() => onOpenItem(item.id)}
                data-testid={`wallet-item-${item.id}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.displayName}</p>
                    <p className="text-muted-foreground text-xs">
                      {getWalletItemTypeLabel(item.itemType)}
                      {item.itemSubtype
                        ? ` • ${getWalletSubtypeLabel(item.itemType, item.itemSubtype) ?? item.itemSubtype}`
                        : ''}
                      {item.documentNumberLast4
                        ? ` • •••• ${item.documentNumberLast4}`
                        : ''}
                    </p>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatExpiryDate(item.expiresOn)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
