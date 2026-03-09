import { BackLink } from '@tearleads/ui';
import { WalletItemTypePicker } from '../../components/wallet/WalletItemTypePicker';
import { useNavigateWithFrom } from '../../lib/navigation';

export function WalletNewItem() {
  const navigateWithFrom = useNavigateWithFrom();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/wallet" defaultLabel="Back to Wallet" />
        <h1 className="font-bold text-2xl tracking-tight">New Wallet Item</h1>
        <p className="text-muted-foreground text-sm">
          Choose the document type to start with the right subtype fields.
        </p>
      </div>

      <WalletItemTypePicker
        onSelectItemType={(itemType) => {
          navigateWithFrom(`/wallet/new/${itemType}`, {
            fromLabel: 'Back to Type Picker'
          });
        }}
      />
    </div>
  );
}
