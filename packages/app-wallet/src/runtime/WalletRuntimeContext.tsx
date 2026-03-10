import type {
  HostRuntimeBaseProps,
  HostRuntimeDatabaseState
} from '@tearleads/shared';
import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { WalletMediaFileOption } from '../lib/walletData';
import type { WalletTracker } from '../lib/walletTracker';
import { DefaultInlineUnlock } from './DefaultInlineUnlock';

export interface InlineUnlockProps {
  description?: string;
}

export type WalletDatabaseState = HostRuntimeDatabaseState;

export interface WalletRuntimeContextValue {
  databaseState: WalletDatabaseState;
  isUnlocked: boolean;
  currentInstanceId: string | null;
  createTracker: () => WalletTracker;
  loadMediaPreview: (
    file: WalletMediaFileOption,
    instanceId: string | null
  ) => Promise<string | null>;
  InlineUnlock: ComponentType<InlineUnlockProps>;
}

const WalletRuntimeContext = createContext<WalletRuntimeContextValue | null>(
  null
);

export interface WalletRuntimeProviderProps extends HostRuntimeBaseProps {
  children: ReactNode;
  createTracker: () => WalletTracker;
  loadMediaPreview: (
    file: WalletMediaFileOption,
    instanceId: string | null
  ) => Promise<string | null>;
  InlineUnlock?: ComponentType<InlineUnlockProps>;
}

export function WalletRuntimeProvider({
  children,
  databaseState,
  createTracker,
  loadMediaPreview,
  InlineUnlock = DefaultInlineUnlock
}: WalletRuntimeProviderProps) {
  const value = useMemo(
    () => ({
      databaseState,
      isUnlocked: databaseState.isUnlocked,
      currentInstanceId: databaseState.currentInstanceId,
      createTracker,
      loadMediaPreview,
      InlineUnlock
    }),
    [databaseState, createTracker, loadMediaPreview, InlineUnlock]
  );

  return (
    <WalletRuntimeContext.Provider value={value}>
      {children}
    </WalletRuntimeContext.Provider>
  );
}

export function useWalletRuntime(): WalletRuntimeContextValue {
  const context = useContext(WalletRuntimeContext);
  if (!context) {
    throw new Error(
      'useWalletRuntime must be used within a WalletRuntimeProvider'
    );
  }
  return context;
}
