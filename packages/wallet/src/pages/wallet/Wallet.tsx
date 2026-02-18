import { BackLink } from '@tearleads/ui';
import { WalletItemsList } from '../../components/wallet/WalletItemsList';
import { useNavigateWithFrom } from '../../lib/navigation';

export function Wallet() {
  const navigateWithFrom = useNavigateWithFrom();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <h1 className="font-bold text-2xl tracking-tight">Wallet</h1>
      </div>

      <WalletItemsList
        onOpenItem={(itemId) =>
          navigateWithFrom(`/wallet/${itemId}`, {
            fromLabel: 'Back to Wallet'
          })
        }
        onCreateItem={() =>
          navigateWithFrom('/wallet/new', {
            fromLabel: 'Back to Wallet'
          })
        }
      />
    </div>
  );
}
