import {
  getWalletItemTypeLabel,
  WALLET_ITEM_TYPES,
  type WalletItemType
} from '../../lib/walletData';

interface WalletItemTypePickerProps {
  onSelectItemType: (itemType: WalletItemType) => void;
}

const TYPE_BADGES: Record<WalletItemType, string> = {
  passport: 'PP',
  driverLicense: 'DL',
  birthCertificate: 'BC',
  creditCard: 'CC',
  debitCard: 'DB',
  identityCard: 'ID',
  insuranceCard: 'IN',
  other: 'OT'
};

const TYPE_HINTS: Record<WalletItemType, string> = {
  passport: 'Travel and identity',
  driverLicense: 'Motor vehicle license',
  birthCertificate: 'Vital records document',
  creditCard: 'Credit payment card',
  debitCard: 'Bank debit card',
  identityCard: 'National or state ID',
  insuranceCard: 'Medical or provider card',
  other: 'Custom document type'
};

export function WalletItemTypePicker({
  onSelectItemType
}: WalletItemTypePickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {WALLET_ITEM_TYPES.map((itemType) => (
        <button
          key={itemType}
          type="button"
          onClick={() => onSelectItemType(itemType)}
          data-testid={`wallet-item-type-${itemType}`}
          className="relative aspect-square rounded-lg border border-border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 hover:shadow-sm"
        >
          <span
            className="absolute top-2 left-2 h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
            aria-hidden="true"
          />
          <span
            className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
            aria-hidden="true"
          />
          <div className="flex h-full flex-col justify-between">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background font-semibold text-xs tracking-wide">
              {TYPE_BADGES[itemType]}
            </span>
            <div>
              <p className="font-medium text-sm leading-tight">
                {getWalletItemTypeLabel(itemType)}
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                {TYPE_HINTS[itemType]}
              </p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
