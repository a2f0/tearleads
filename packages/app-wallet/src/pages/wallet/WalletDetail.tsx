import { BackLink } from '@tearleads/ui';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WalletItemDetail } from '../../components/wallet/WalletItemDetail';
import type { SaveWalletItemResult } from '../../lib/walletData';
import { isWalletItemType } from '../../lib/walletTypes';

export function WalletDetail() {
  const navigate = useNavigate();
  const { id, itemType } = useParams<{ id?: string; itemType?: string }>();
  const selectedItemType =
    itemType && isWalletItemType(itemType) ? itemType : null;

  const itemId = selectedItemType ? 'new' : (id ?? 'new');

  useEffect(() => {
    if (itemType && !isWalletItemType(itemType)) {
      navigate('/wallet/new', { replace: true });
    }
  }, [itemType, navigate]);

  const handleSaved = (result: SaveWalletItemResult) => {
    if (itemId === 'new' || itemId !== result.id) {
      navigate(`/wallet/${result.id}`);
    }
  };

  return (
    <div className="space-y-6">
      <BackLink defaultTo="/wallet" defaultLabel="Back to Wallet" />
      <WalletItemDetail
        itemId={itemId}
        {...(selectedItemType ? { initialItemType: selectedItemType } : {})}
        onSaved={handleSaved}
        onDeleted={() => navigate('/wallet')}
        onCreateItem={() => navigate('/wallet/new')}
      />
    </div>
  );
}
