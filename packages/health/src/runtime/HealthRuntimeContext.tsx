import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { HealthTracker } from '../lib/healthTracker';
import { DefaultInlineUnlock } from './DefaultInlineUnlock';

export interface InlineUnlockProps {
  description?: string;
}

export interface HealthRuntimeContextValue {
  isUnlocked: boolean;
  createTracker: () => HealthTracker;
  InlineUnlock: ComponentType<InlineUnlockProps>;
}

const defaultContext: HealthRuntimeContextValue = {
  isUnlocked: false,
  createTracker: () => {
    throw new Error('HealthRuntimeProvider is required');
  },
  InlineUnlock: DefaultInlineUnlock
};

const HealthRuntimeContext =
  createContext<HealthRuntimeContextValue>(defaultContext);

export interface HealthRuntimeProviderProps {
  children: ReactNode;
  isUnlocked: boolean;
  createTracker: () => HealthTracker;
  InlineUnlock?: ComponentType<InlineUnlockProps>;
}

export function HealthRuntimeProvider({
  children,
  isUnlocked,
  createTracker,
  InlineUnlock = DefaultInlineUnlock
}: HealthRuntimeProviderProps) {
  const value = useMemo(
    () => ({ isUnlocked, createTracker, InlineUnlock }),
    [isUnlocked, createTracker, InlineUnlock]
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
