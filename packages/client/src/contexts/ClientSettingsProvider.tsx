/**
 * Client-side SettingsProvider wrapper that supplies database operations
 * to the @tearleads/app-settings package provider.
 */

import type { SettingValueMap, UserSettingKey } from '@tearleads/app-settings';
import {
  SettingsProvider,
  type SettingsProviderProps
} from '@tearleads/app-settings';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { useDatabaseContext } from '@/db/hooks';
import { getSettingsFromDb, saveSettingToDb } from '@/db/userSettings';

interface ClientSettingsProviderProps {
  children: ReactNode;
}

export function ClientSettingsProvider({
  children
}: ClientSettingsProviderProps) {
  const { db, currentInstanceId } = useDatabaseContext();

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

  if (currentInstanceId) {
    providerProps.instanceId = currentInstanceId;
  }

  if (getSettingsFromDbFn) {
    providerProps.getSettingsFromDb = getSettingsFromDbFn;
  }

  if (db) {
    providerProps.saveSettingToDb = saveSettingToDbFn;
  }

  return <SettingsProvider {...providerProps} />;
}
