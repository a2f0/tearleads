import type { ComponentType } from 'react';
import type { WalletMediaFileOption } from './walletData';

interface WalletDatabaseContextValue {
  isLoading: boolean;
  isUnlocked: boolean;
  currentInstanceId: string | null;
}

interface InlineUnlockProps {
  description?: string;
}

export interface WalletUiDependencies {
  useDatabaseContext: () => WalletDatabaseContextValue;
  InlineUnlock: ComponentType<InlineUnlockProps>;
  loadWalletMediaPreview: (
    file: WalletMediaFileOption,
    currentInstanceId: string | null
  ) => Promise<string | null>;
}

let dependencies: WalletUiDependencies | null = null;

export function setWalletUiDependencies(next: WalletUiDependencies): void {
  dependencies = next;
}

export function getWalletUiDependencies(): WalletUiDependencies | null {
  return dependencies;
}
