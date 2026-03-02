import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { WalletMediaFileOption } from '../lib/walletData';
import type { WalletTracker } from '../lib/walletTracker';

export interface InlineUnlockProps {
  description?: string;
}

function DefaultInlineUnlock({ description }: InlineUnlockProps) {
  return (
    <div className="rounded-md border border-dashed p-4 text-muted-foreground text-sm">
      Unlock your database to use {description}.
    </div>
  );
}

export interface WalletRuntimeContextValue {
  isUnlocked: boolean;
  currentInstanceId: string | null;
  createTracker: () => WalletTracker;
  loadMediaPreview: (
    file: WalletMediaFileOption,
    instanceId: string | null
  ) => Promise<string | null>;
  InlineUnlock: ComponentType<InlineUnlockProps>;
}

const defaultContext: WalletRuntimeContextValue = {
  isUnlocked: false,
  currentInstanceId: null,
  createTracker: () => {
    throw new Error('WalletRuntimeProvider is required');
  },
  loadMediaPreview: async () => null,
  InlineUnlock: DefaultInlineUnlock
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
  InlineUnlock?: ComponentType<InlineUnlockProps>;
}

export function WalletRuntimeProvider({
  children,
  isUnlocked,
  currentInstanceId,
  createTracker,
  loadMediaPreview,
  InlineUnlock = DefaultInlineUnlock
}: WalletRuntimeProviderProps) {
  const value = useMemo(
    () => ({
      isUnlocked,
      currentInstanceId,
      createTracker,
      loadMediaPreview,
      InlineUnlock
    }),
    [isUnlocked, currentInstanceId, createTracker, loadMediaPreview, InlineUnlock]
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
