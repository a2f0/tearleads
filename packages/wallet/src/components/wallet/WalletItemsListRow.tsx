import {
  getWalletItemTypeLabel,
  type WalletItemSummary
} from '../../lib/walletData';
import { getWalletSubtypeLabel } from '../../lib/walletSubtypes';

interface WalletItemsListRowProps {
  item: WalletItemSummary;
  onOpenItem: (itemId: string) => void;
}

function formatExpiryDate(expiresOn: Date | null): string {
  if (!expiresOn) {
    return 'No expiry date';
  }
  return expiresOn.toLocaleDateString();
}

export function WalletItemsListRow({
  item,
  onOpenItem
}: WalletItemsListRowProps) {
  return (
    <button
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
  );
}
