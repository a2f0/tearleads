/**
 * Client-side SettingsProvider wrapper that supplies database operations
 * to the @tearleads/settings package provider.
 */

import type { SettingValueMap, UserSettingKey } from '@tearleads/settings';
import {
  SettingsProvider,
  type SettingsProviderProps
} from '@tearleads/settings';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { useDatabaseOptional } from '@/db/hooks';
import { getSettingsFromDb, saveSettingToDb } from '@/db/userSettings';

interface ClientSettingsProviderProps {
  children: ReactNode;
}

export function ClientSettingsProvider({
  children
}: ClientSettingsProviderProps) {
  const db = useDatabaseOptional();

  // Wrap getSettingsFromDb to close over the current db instance
  const getSettingsFromDbFn = useMemo(() => {
    if (!db) return undefined;
    return () => getSettingsFromDb(db);
  }, [db]);

  // Wrap saveSettingToDb to close over the current db instance
  const saveSettingToDbFn = useCallback(
    async <K extends UserSettingKey>(key: K, value: SettingValueMap[K]) => {
      if (!db) return;
      await saveSettingToDb(db, key, value);
    },
    [db]
  );

  // Build props conditionally to satisfy exactOptionalPropertyTypes
  const providerProps: SettingsProviderProps = {
    children
  };

  if (getSettingsFromDbFn) {
    providerProps.getSettingsFromDb = getSettingsFromDbFn;
  }

  if (db) {
    providerProps.saveSettingToDb = saveSettingToDbFn;
  }

  return <SettingsProvider {...providerProps} />;
}
