import {
  getWalletItemTypeLabel,
  WALLET_ITEM_TYPES,
  type WalletItemType
} from './walletTypes';

export { getWalletItemTypeLabel, WALLET_ITEM_TYPES, type WalletItemType };

export type WalletMediaSide = 'front' | 'back';

export interface WalletItemSummary {
  id: string;
  itemType: WalletItemType;
  itemSubtype: string | null;
  displayName: string;
  documentNumberLast4: string | null;
  expiresOn: Date | null;
  updatedAt: Date;
}

export interface WalletMediaFileOption {
  id: string;
  name: string;
  mimeType: string;
  storagePath: string;
  thumbnailPath: string | null;
  uploadDate: Date;
}

export interface WalletItemDetailRecord extends WalletItemSummary {
  issuingAuthority: string | null;
  countryCode: string | null;
  issuedOn: Date | null;
  notes: string | null;
  createdAt: Date;
  frontFileId: string | null;
  frontFileName: string | null;
  backFileId: string | null;
  backFileName: string | null;
  subtypeFields: Record<string, string>;
}

export interface SaveWalletItemInput {
  id?: string;
  itemType: WalletItemType;
  itemSubtype: string;
  subtypeFields: Record<string, string>;
  displayName: string;
  issuingAuthority: string;
  countryCode: string;
  documentNumberLast4: string;
  issuedOn: string;
  expiresOn: string;
  notes: string;
  frontFileId: string | null;
  backFileId: string | null;
}

export interface SaveWalletItemResult {
  id: string;
  created: boolean;
}

export function toDateInputValue(value: Date | null): string {
  if (!value) {
    return '';
  }

  return value.toISOString().slice(0, 10);
}
