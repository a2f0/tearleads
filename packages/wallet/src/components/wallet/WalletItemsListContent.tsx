import { Button } from '@tearleads/ui';
import { CreditCard, Loader2, Plus } from 'lucide-react';
import type { WalletItemSummary } from '../../lib/walletData';
import { WalletItemsListRow } from './WalletItemsListRow';

interface WalletItemsListContentProps {
  items: WalletItemSummary[];
  loadingItems: boolean;
  onCreateItem: () => void;
  onOpenItem: (itemId: string) => void;
}

export function WalletItemsListContent({
  items,
  loadingItems,
  onCreateItem,
  onOpenItem
}: WalletItemsListContentProps) {
  if (loadingItems && items.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading wallet items...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
        <CreditCard className="h-8 w-8" />
        <p>No wallet items yet.</p>
        <Button variant="outline" onClick={onCreateItem}>
          <Plus className="mr-2 h-4 w-4" />
          Add your first item
        </Button>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {items.map((item) => (
        <WalletItemsListRow key={item.id} item={item} onOpenItem={onOpenItem} />
      ))}
    </div>
  );
}
