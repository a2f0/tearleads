import type {
  HostRuntimeBaseProps,
  HostRuntimeDatabaseState
} from '@tearleads/shared';
import { createContext, type ReactNode, useContext } from 'react';

export type BusinessesDatabaseState = HostRuntimeDatabaseState;

interface BusinessesContextValue {
  databaseState: BusinessesDatabaseState;
}

const BusinessesContext = createContext<BusinessesContextValue | null>(null);

export interface BusinessesProviderProps extends HostRuntimeBaseProps {
  children: ReactNode;
}

export function BusinessesProvider({
  children,
  databaseState
}: BusinessesProviderProps) {
  return (
    <BusinessesContext.Provider
      value={{
        databaseState
      }}
    >
      {children}
    </BusinessesContext.Provider>
  );
}

export function useBusinesses(): BusinessesContextValue {
  const context = useContext(BusinessesContext);
  if (!context) {
    throw new Error(
      'Businesses context is not available. Ensure BusinessesProvider is configured.'
    );
  }
  return context;
}

export function useBusinessesDatabaseState(): BusinessesDatabaseState {
  const { databaseState } = useBusinesses();
  return databaseState;
}
