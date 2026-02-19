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

export interface WalletDataDependencies {
  listWalletItems: () => Promise<WalletItemSummary[]>;
  listWalletMediaFiles: () => Promise<WalletMediaFileOption[]>;
  getWalletItemDetail: (
    itemId: string
  ) => Promise<WalletItemDetailRecord | null>;
  saveWalletItem: (input: SaveWalletItemInput) => Promise<SaveWalletItemResult>;
  softDeleteWalletItem: (itemId: string) => Promise<void>;
}

let dependencies: WalletDataDependencies | null = null;

export function setWalletDataDependencies(next: WalletDataDependencies): void {
  dependencies = next;
}

export function toDateInputValue(value: Date | null): string {
  if (!value) {
    return '';
  }

  return value.toISOString().slice(0, 10);
}

function getDependenciesOrThrow(): WalletDataDependencies {
  if (!dependencies) {
    throw new Error('Wallet data dependencies are not configured.');
  }
  return dependencies;
}

export async function listWalletItems(): Promise<WalletItemSummary[]> {
  return getDependenciesOrThrow().listWalletItems();
}

export async function listWalletMediaFiles(): Promise<WalletMediaFileOption[]> {
  return getDependenciesOrThrow().listWalletMediaFiles();
}

export async function getWalletItemDetail(
  itemId: string
): Promise<WalletItemDetailRecord | null> {
  return getDependenciesOrThrow().getWalletItemDetail(itemId);
}

export async function saveWalletItem(
  input: SaveWalletItemInput
): Promise<SaveWalletItemResult> {
  return getDependenciesOrThrow().saveWalletItem(input);
}

export async function softDeleteWalletItem(itemId: string): Promise<void> {
  return getDependenciesOrThrow().softDeleteWalletItem(itemId);
}
