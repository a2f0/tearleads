import { Input } from '@tearleads/ui';
import { getWalletItemTypeLabel } from '../../lib/walletData';
import type { WalletItemFormState } from './walletItemFormUtils';

interface WalletItemDisplayNameFieldProps {
  form: WalletItemFormState;
  automaticDisplayName: string;
  customDisplayNameEnabled: boolean;
  isOtherType: boolean;
  onFieldChange: (field: keyof WalletItemFormState, value: string) => void;
  onCustomDisplayNameEnabledChange: (enabled: boolean) => void;
}

export function WalletItemDisplayNameField({
  form,
  automaticDisplayName,
  customDisplayNameEnabled,
  isOtherType,
  onFieldChange,
  onCustomDisplayNameEnabledChange
}: WalletItemDisplayNameFieldProps) {
  if (isOtherType) {
    return (
      <div className="space-y-2">
        <label className="font-medium text-sm" htmlFor="wallet-display-name">
          Display Name
        </label>
        <Input
          id="wallet-display-name"
          value={form.displayName}
          onChange={(event) => onFieldChange('displayName', event.target.value)}
          placeholder="Custom Wallet Item"
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 md:col-span-2">
      <label className="font-medium text-sm" htmlFor="wallet-display-name">
        Display Name
      </label>
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
        {automaticDisplayName || getWalletItemTypeLabel(form.itemType)}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={customDisplayNameEnabled}
          onChange={(event) => {
            const nextEnabled = event.target.checked;
            onCustomDisplayNameEnabledChange(nextEnabled);
            if (nextEnabled && form.displayName.trim().length === 0) {
              onFieldChange('displayName', automaticDisplayName);
            }
          }}
        />
        Use custom display name
      </label>
      {customDisplayNameEnabled && (
        <Input
          id="wallet-display-name"
          value={form.displayName}
          onChange={(event) => onFieldChange('displayName', event.target.value)}
          placeholder={
            automaticDisplayName || getWalletItemTypeLabel(form.itemType)
          }
        />
      )}
    </div>
  );
}
