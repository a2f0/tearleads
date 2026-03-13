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

export interface AvailableContact {
  id: string;
  name: string;
}

export interface HealthRuntimeContextValue {
  databaseState: HealthDatabaseState;
  isUnlocked: boolean;
  createTracker: () => HealthTracker;
  InlineUnlock: ComponentType<InlineUnlockProps>;
  registerReadingInVfs: (readingId: string, createdAt: string) => Promise<void>;
  linkReadingToContact: (
    readingId: string,
    contactId: string
  ) => Promise<void>;
  availableContacts: AvailableContact[];
}

const HealthRuntimeContext = createContext<HealthRuntimeContextValue | null>(
  null
);

export interface HealthRuntimeProviderProps extends HostRuntimeBaseProps {
  children: ReactNode;
  createTracker: () => HealthTracker;
  InlineUnlock?: ComponentType<InlineUnlockProps>;
  registerReadingInVfs?: (
    readingId: string,
    createdAt: string
  ) => Promise<void>;
  linkReadingToContact?: (
    readingId: string,
    contactId: string
  ) => Promise<void>;
  availableContacts?: AvailableContact[];
}

const noop = async () => {};

export function HealthRuntimeProvider({
  children,
  databaseState,
  createTracker,
  InlineUnlock = DefaultInlineUnlock,
  registerReadingInVfs = noop,
  linkReadingToContact = noop,
  availableContacts = []
}: HealthRuntimeProviderProps) {
  const value = useMemo(
    () => ({
      databaseState,
      isUnlocked: databaseState.isUnlocked,
      createTracker,
      InlineUnlock,
      registerReadingInVfs,
      linkReadingToContact,
      availableContacts
    }),
    [
      databaseState,
      createTracker,
      InlineUnlock,
      registerReadingInVfs,
      linkReadingToContact,
      availableContacts
    ]
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
