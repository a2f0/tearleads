import { BackLink } from '@client/components/ui/back-link';
import { useNavigate, useParams } from 'react-router-dom';
import { WalletItemDetail } from '../../components/wallet/WalletItemDetail';
import type { SaveWalletItemResult } from '../../lib/walletData';

export function WalletDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const itemId = id ?? 'new';

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
        onSaved={handleSaved}
        onDeleted={() => navigate('/wallet')}
        onCreateItem={() => navigate('/wallet/new')}
      />
    </div>
  );
}
