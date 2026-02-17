import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import type { HealthTracker } from '../lib/healthTracker';

export interface HealthRuntimeContextValue {
  isUnlocked: boolean;
  createTracker: () => HealthTracker;
}

const defaultContext: HealthRuntimeContextValue = {
  isUnlocked: false,
  createTracker: () => {
    throw new Error('HealthRuntimeProvider is required');
  }
};

const HealthRuntimeContext =
  createContext<HealthRuntimeContextValue>(defaultContext);

export interface HealthRuntimeProviderProps {
  children: ReactNode;
  isUnlocked: boolean;
  createTracker: () => HealthTracker;
}

export function HealthRuntimeProvider({
  children,
  isUnlocked,
  createTracker
}: HealthRuntimeProviderProps) {
  return (
    <HealthRuntimeContext.Provider value={{ isUnlocked, createTracker }}>
      {children}
    </HealthRuntimeContext.Provider>
  );
}

export function useHealthRuntime(): HealthRuntimeContextValue {
  return useContext(HealthRuntimeContext);
}
