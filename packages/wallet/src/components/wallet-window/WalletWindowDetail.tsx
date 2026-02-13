import type { SaveWalletItemResult } from '../../lib/walletData';
import { WalletItemDetail } from '../wallet/WalletItemDetail';

interface WalletWindowDetailProps {
  itemId: string;
  onSaved: (result: SaveWalletItemResult) => void;
  onDeleted: (itemId: string) => void;
  onCreateItem: () => void;
}

export function WalletWindowDetail({
  itemId,
  onSaved,
  onDeleted,
  onCreateItem
}: WalletWindowDetailProps) {
  return (
    <WalletItemDetail
      itemId={itemId}
      onSaved={onSaved}
      onDeleted={onDeleted}
      onCreateItem={onCreateItem}
    />
  );
}
