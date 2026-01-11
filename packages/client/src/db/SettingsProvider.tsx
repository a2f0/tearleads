/**
 * React context provider for user settings with localStorage/SQLite sync.
 *
 * This provider syncs settings between localStorage (for fast startup) and
 * the user_settings SQLite table (for encrypted backup/restore).
 *
 * When the database is unlocked, settings from the database are synced to
 * localStorage and a 'settings-synced' custom event is dispatched so that
 * ThemeProvider and i18n can update their state.
 */

import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useDatabaseOptional } from './hooks';
import type { SettingValueMap, UserSettingKey } from './user-settings';
import {
  dispatchSettingsSyncedEvent,
  getSettingFromStorage,
  getSettingsFromDb,
  SETTING_DEFAULTS,
  saveSettingToDb,
  setSettingInStorage
} from './user-settings';

interface SettingsContextValue {
  /** Get a setting value (from cache, localStorage, or default) */
  getSetting: <K extends UserSettingKey>(key: K) => SettingValueMap[K];
  /** Set a setting value (syncs to localStorage and DB if unlocked) */
  setSetting: <K extends UserSettingKey>(
    key: K,
    value: SettingValueMap[K]
  ) => void;
  /** Whether settings have been synced from the database */
  isSynced: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

interface SettingsProviderProps {
  children: ReactNode;
}

/**
 * Provider component for user settings.
 * Must be used inside DatabaseProvider.
 */
export function SettingsProvider({ children }: SettingsProviderProps) {
  const db = useDatabaseOptional();
  const [isSynced, setIsSynced] = useState(false);
  const [settings, setSettings] = useState<
    Partial<{ [K in UserSettingKey]: SettingValueMap[K] }>
  >({});
  const hasSyncedRef = useRef(false);

  // Sync settings from DB when database becomes available
  useEffect(() => {
    async function syncFromDb() {
      if (!db || hasSyncedRef.current) return;

      try {
        const dbSettings = await getSettingsFromDb(db);

        // Write DB values to localStorage (DB is source of truth for restore)
        for (const key of Object.keys(dbSettings) as UserSettingKey[]) {
          const value = dbSettings[key];
          if (value !== undefined) {
            setSettingInStorage(key, value);
          }
        }

        setSettings(dbSettings);
        setIsSynced(true);
        hasSyncedRef.current = true;

        // Dispatch event for ThemeProvider and i18n to react
        if (Object.keys(dbSettings).length > 0) {
          dispatchSettingsSyncedEvent(dbSettings);
        }
      } catch (err) {
        console.warn('Failed to sync settings from database:', err);
      }
    }

    syncFromDb();
  }, [db]);

  // Reset sync state when database is locked
  useEffect(() => {
    if (!db) {
      hasSyncedRef.current = false;
      setIsSynced(false);
    }
  }, [db]);

  const getSetting = useCallback(
    <K extends UserSettingKey>(key: K): SettingValueMap[K] => {
      // First check in-memory cache
      if (settings[key] !== undefined) {
        return settings[key] as SettingValueMap[K];
      }
      // Then check localStorage
      const stored = getSettingFromStorage(key);
      if (stored !== null) {
        return stored;
      }
      // Fall back to default
      return SETTING_DEFAULTS[key];
    },
    [settings]
  );

  const setSetting = useCallback(
    <K extends UserSettingKey>(key: K, value: SettingValueMap[K]): void => {
      // Update in-memory state
      setSettings((prev) => ({ ...prev, [key]: value }));

      // Always write to localStorage (for fast startup on next load)
      setSettingInStorage(key, value);

      // Write to DB if available
      if (db) {
        saveSettingToDb(db, key, value).catch((err) => {
          console.warn(`Failed to save setting ${key} to database:`, err);
        });
      }
    },
    [db]
  );

  const value = useMemo(
    (): SettingsContextValue => ({
      getSetting,
      setSetting,
      isSynced
    }),
    [getSetting, setSetting, isSynced]
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * Hook to access the settings context.
 * Throws if used outside SettingsProvider.
 */
export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

/**
 * Hook to access the settings context optionally.
 * Returns null if used outside SettingsProvider.
 */
export function useSettingsOptional(): SettingsContextValue | null {
  return useContext(SettingsContext);
}
