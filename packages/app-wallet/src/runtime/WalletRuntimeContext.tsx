import type { HostRuntimeDatabaseState } from '@tearleads/shared';
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

const FALLBACK_DATABASE_STATE: WalletDatabaseState = {
  isUnlocked: false,
  isLoading: false,
  currentInstanceId: null
};

const defaultContext: WalletRuntimeContextValue = {
  databaseState: FALLBACK_DATABASE_STATE,
  isUnlocked: FALLBACK_DATABASE_STATE.isUnlocked,
  currentInstanceId: FALLBACK_DATABASE_STATE.currentInstanceId,
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
  databaseState?: WalletDatabaseState;
  /**
   * @deprecated Prefer `databaseState` to align with shared host runtime contracts.
   */
  isUnlocked?: boolean;
  /**
   * @deprecated Prefer `databaseState` to align with shared host runtime contracts.
   */
  currentInstanceId?: string | null;
  createTracker: () => WalletTracker;
  loadMediaPreview: (
    file: WalletMediaFileOption,
    instanceId: string | null
  ) => Promise<string | null>;
  InlineUnlock?: ComponentType<InlineUnlockProps>;
}

function createFallbackDatabaseState(
  isUnlocked: boolean | undefined,
  currentInstanceId: string | null | undefined
): WalletDatabaseState {
  return {
    ...FALLBACK_DATABASE_STATE,
    isUnlocked: isUnlocked ?? FALLBACK_DATABASE_STATE.isUnlocked,
    currentInstanceId:
      currentInstanceId ?? FALLBACK_DATABASE_STATE.currentInstanceId
  };
}

export function WalletRuntimeProvider({
  children,
  databaseState,
  isUnlocked,
  currentInstanceId,
  createTracker,
  loadMediaPreview,
  InlineUnlock = DefaultInlineUnlock
}: WalletRuntimeProviderProps) {
  const resolvedDatabaseState = useMemo(
    () =>
      databaseState ??
      createFallbackDatabaseState(isUnlocked, currentInstanceId),
    [databaseState, isUnlocked, currentInstanceId]
  );

  const value = useMemo(
    () => ({
      databaseState: resolvedDatabaseState,
      isUnlocked: resolvedDatabaseState.isUnlocked,
      currentInstanceId: resolvedDatabaseState.currentInstanceId,
      createTracker,
      loadMediaPreview,
      InlineUnlock
    }),
    [resolvedDatabaseState, createTracker, loadMediaPreview, InlineUnlock]
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
