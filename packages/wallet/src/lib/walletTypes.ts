export const WALLET_ITEM_TYPES = [
  'passport',
  'driverLicense',
  'birthCertificate',
  'creditCard',
  'debitCard',
  'identityCard',
  'insuranceCard',
  'other'
] as const;

export type WalletItemType = (typeof WALLET_ITEM_TYPES)[number];

const WALLET_ITEM_TYPE_LABELS: Record<WalletItemType, string> = {
  passport: 'Passport',
  driverLicense: 'Driver License',
  birthCertificate: 'Birth Certificate',
  creditCard: 'Credit Card',
  debitCard: 'Debit Card',
  identityCard: 'Identity Card',
  insuranceCard: 'Insurance Card',
  other: 'Other'
};

export function isWalletItemType(value: string): value is WalletItemType {
  return WALLET_ITEM_TYPES.some((itemType) => itemType === value);
}

export function getWalletItemTypeLabel(itemType: WalletItemType): string {
  return WALLET_ITEM_TYPE_LABELS[itemType];
}
