import { WalletItemDetail } from '../wallet/WalletItemDetail';
import type { SaveWalletItemResult } from '../../lib/walletData';

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
