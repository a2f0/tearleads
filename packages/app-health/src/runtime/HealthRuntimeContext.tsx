import type {
  HostRuntimeBaseProps,
  HostRuntimeDatabaseState
} from '@tearleads/shared';
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

const HealthRuntimeContext = createContext<HealthRuntimeContextValue | null>(
  null
);

export interface HealthRuntimeProviderProps extends HostRuntimeBaseProps {
  children: ReactNode;
  createTracker: () => HealthTracker;
  InlineUnlock?: ComponentType<InlineUnlockProps>;
}

export function HealthRuntimeProvider({
  children,
  databaseState,
  createTracker,
  InlineUnlock = DefaultInlineUnlock
}: HealthRuntimeProviderProps) {
  const value = useMemo(
    () => ({
      databaseState,
      isUnlocked: databaseState.isUnlocked,
      createTracker,
      InlineUnlock
    }),
    [databaseState, createTracker, InlineUnlock]
  );

  return (
    <HealthRuntimeContext.Provider value={value}>
      {children}
    </HealthRuntimeContext.Provider>
  );
}

export function useHealthRuntime(): HealthRuntimeContextValue {
  const context = useContext(HealthRuntimeContext);
  if (!context) {
    throw new Error(
      'useHealthRuntime must be used within a HealthRuntimeProvider'
    );
  }
  return context;
}
