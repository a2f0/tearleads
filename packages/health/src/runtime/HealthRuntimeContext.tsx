import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { HealthTracker } from '../lib/healthTracker';
import { DefaultInlineUnlock } from './DefaultInlineUnlock';

export interface InlineUnlockProps {
  description?: string;
}

export type HealthDatabaseState = HostRuntimeDatabaseState;

export interface HealthRuntimeContextValue {
  databaseState: HealthDatabaseState;
  isUnlocked: boolean;
  createTracker: () => HealthTracker;
  InlineUnlock: ComponentType<InlineUnlockProps>;
}

const FALLBACK_DATABASE_STATE: HealthDatabaseState = {
  isUnlocked: false,
  isLoading: false,
  currentInstanceId: null
};

const defaultContext: HealthRuntimeContextValue = {
  databaseState: FALLBACK_DATABASE_STATE,
  isUnlocked: FALLBACK_DATABASE_STATE.isUnlocked,
  createTracker: () => {
    throw new Error('HealthRuntimeProvider is required');
  },
  InlineUnlock: DefaultInlineUnlock
};

const HealthRuntimeContext =
  createContext<HealthRuntimeContextValue>(defaultContext);

export interface HealthRuntimeProviderProps {
  children: ReactNode;
  databaseState?: HealthDatabaseState;
  /**
   * @deprecated Prefer `databaseState` to align with shared host runtime contracts.
   */
  isUnlocked?: boolean;
  createTracker: () => HealthTracker;
  InlineUnlock?: ComponentType<InlineUnlockProps>;
}

function createFallbackDatabaseState(
  isUnlocked: boolean | undefined
): HealthDatabaseState {
  return {
    ...FALLBACK_DATABASE_STATE,
    isUnlocked: isUnlocked ?? FALLBACK_DATABASE_STATE.isUnlocked
  };
}

export function HealthRuntimeProvider({
  children,
  databaseState,
  isUnlocked,
  createTracker,
  InlineUnlock = DefaultInlineUnlock
}: HealthRuntimeProviderProps) {
  const resolvedDatabaseState = useMemo(
    () => databaseState ?? createFallbackDatabaseState(isUnlocked),
    [databaseState, isUnlocked]
  );

  const value = useMemo(
    () => ({
      databaseState: resolvedDatabaseState,
      isUnlocked: resolvedDatabaseState.isUnlocked,
      createTracker,
      InlineUnlock
    }),
    [resolvedDatabaseState, createTracker, InlineUnlock]
  );

  return (
    <HealthRuntimeContext.Provider value={value}>
      {children}
    </HealthRuntimeContext.Provider>
  );
}

export function useHealthRuntime(): HealthRuntimeContextValue {
  return useContext(HealthRuntimeContext);
}
