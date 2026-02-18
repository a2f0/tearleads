import { createContext, useContext } from 'react';
import type { Database } from '../index';
import type { DatabaseContextValue } from './useDatabaseTypes';

export const DatabaseContext = createContext<DatabaseContextValue | null>(null);

export function useDatabaseContext(): DatabaseContextValue {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error(
      'useDatabaseContext must be used within a DatabaseProvider'
    );
  }
  return context;
}

export function useDatabase(): Database {
  const { db, isUnlocked } = useDatabaseContext();
  if (!isUnlocked || !db) {
    throw new Error(
      'Database is not unlocked. Use useDatabaseContext for conditional access.'
    );
  }
  return db;
}

export function useDatabaseOptional(): Database | null {
  const { db } = useDatabaseContext();
  return db;
}
