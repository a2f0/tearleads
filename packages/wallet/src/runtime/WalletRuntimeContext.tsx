import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { WalletMediaFileOption } from '../lib/walletData';
import type { WalletTracker } from '../lib/walletTracker';

export interface WalletRuntimeContextValue {
  isUnlocked: boolean;
  currentInstanceId: string | null;
  createTracker: () => WalletTracker;
  loadMediaPreview: (
    file: WalletMediaFileOption,
    instanceId: string | null
  ) => Promise<string | null>;
}

const defaultContext: WalletRuntimeContextValue = {
  isUnlocked: false,
  currentInstanceId: null,
  createTracker: () => {
    throw new Error('WalletRuntimeProvider is required');
  },
  loadMediaPreview: async () => null
};

const WalletRuntimeContext =
  createContext<WalletRuntimeContextValue>(defaultContext);

export interface WalletRuntimeProviderProps {
  children: ReactNode;
  isUnlocked: boolean;
  currentInstanceId: string | null;
  createTracker: () => WalletTracker;
  loadMediaPreview: (
    file: WalletMediaFileOption,
    instanceId: string | null
  ) => Promise<string | null>;
}

export function WalletRuntimeProvider({
  children,
  isUnlocked,
  currentInstanceId,
  createTracker,
  loadMediaPreview
}: WalletRuntimeProviderProps) {
  const value = useMemo(
    () => ({ isUnlocked, currentInstanceId, createTracker, loadMediaPreview }),
    [isUnlocked, currentInstanceId, createTracker, loadMediaPreview]
  );

  return (
    <WalletRuntimeContext.Provider value={value}>
      {children}
    </WalletRuntimeContext.Provider>
  );
}

export function useWalletRuntime(): WalletRuntimeContextValue {
  return useContext(WalletRuntimeContext);
}
