/**
 * Client-side BusinessesProvider wrapper that supplies all dependencies
 * to the @tearleads/app-businesses package components.
 */

import { BusinessesProvider } from '@tearleads/app-businesses';
import type { ReactNode } from 'react';
import { useHostRuntimeDatabaseState } from '@/db/hooks/useHostRuntimeDatabaseState';

interface ClientBusinessesProviderProps {
  children: ReactNode;
}

export function ClientBusinessesProvider({
  children
}: ClientBusinessesProviderProps) {
  const databaseState = useHostRuntimeDatabaseState();

  return (
    <BusinessesProvider databaseState={databaseState}>
      {children}
    </BusinessesProvider>
  );
}
