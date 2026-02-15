/**
 * React context provider for user settings with localStorage sync.
 *
 * This provider manages settings between localStorage (for fast startup) and
 * optionally syncs with a database when DB operations are provided via props.
 *
 * When database operations are provided and settings are synced from the database,
 * a 'settings-synced' custom event is dispatched so that ThemeProvider and i18n
 * can update their state.
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
import type { SettingValueMap, UserSettingKey } from '../types/userSettings.js';
import {
  dispatchSettingsSyncedEvent,
  getSettingFromStorage,
  SETTING_DEFAULTS,
  setSettingInStorage
} from '../types/userSettings.js';

interface SettingsContextValue {
  /** Get a setting value (from cache, localStorage, or default) */
  getSetting: <K extends UserSettingKey>(key: K) => SettingValueMap[K];
  /** Set a setting value (syncs to localStorage and DB if available) */
  setSetting: <K extends UserSettingKey>(
    key: K,
    value: SettingValueMap[K]
  ) => void;
  /** Whether settings have been synced from the database */
  isSynced: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export interface SettingsProviderProps {
  children: ReactNode;
  /** Optional function to get settings from database */
  getSettingsFromDb?: () => Promise<
    Partial<{ [K in UserSettingKey]: SettingValueMap[K] }>
  >;
  /** Optional function to save a setting to database */
  saveSettingToDb?: <K extends UserSettingKey>(
    key: K,
    value: SettingValueMap[K]
  ) => Promise<void>;
}

/**
 * Provider component for user settings.
 * Optionally receives database operations for sync.
 */
export function SettingsProvider({
  children,
  getSettingsFromDb,
  saveSettingToDb
}: SettingsProviderProps) {
  const [isSynced, setIsSynced] = useState(false);
  const [settings, setSettings] = useState<
    Partial<{ [K in UserSettingKey]: SettingValueMap[K] }>
  >({});
  const hasSyncedRef = useRef(false);

  // Sync settings from DB when database operations are available
  useEffect(() => {
    async function syncFromDb() {
      if (!getSettingsFromDb || hasSyncedRef.current) return;

      try {
        const dbSettings = await getSettingsFromDb();

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
  }, [getSettingsFromDb]);

  // Reset sync state when database operations become unavailable
  useEffect(() => {
    if (!getSettingsFromDb) {
      hasSyncedRef.current = false;
      setIsSynced(false);
    }
  }, [getSettingsFromDb]);

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
      if (saveSettingToDb) {
        saveSettingToDb(key, value).catch((err) => {
          console.warn(`Failed to save setting ${key} to database:`, err);
        });
      }
    },
    [saveSettingToDb]
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
