import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';

export type Theme = 'light' | 'dark' | 'tokyo-night' | 'graphite' | 'system';
export type ResolvedTheme = 'light' | 'dark' | 'tokyo-night' | 'graphite';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: ResolvedTheme;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'theme';
const VALID_THEMES: Theme[] = [
  'light',
  'dark',
  'tokyo-night',
  'graphite',
  'system'
];

function isTheme(value: string): value is Theme {
  return VALID_THEMES.some((theme) => theme === value);
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = STORAGE_KEY
}: ThemeProviderProps) {
  // Use consistent initial values for SSR/hydration matching
  // The inline script in Layout.astro handles the visual theme immediately
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>('light');

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  // Initialize from localStorage and system preferences after hydration
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored && isTheme(stored)) {
      setThemeState(stored);
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [storageKey]);

  // Listen for settings-synced event from SettingsProvider (database sync)
  useEffect(() => {
    const handleSettingsSynced = (event: Event) => {
      const customEvent = event as CustomEvent<{
        settings: { theme?: string };
      }>;
      const { settings } = customEvent.detail;
      if (settings.theme && isTheme(settings.theme)) {
        setThemeState(settings.theme);
      }
    };

    window.addEventListener('settings-synced', handleSettingsSynced);
    return () => {
      window.removeEventListener('settings-synced', handleSettingsSynced);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'tokyo-night', 'graphite');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      localStorage.setItem(storageKey, newTheme);
    },
    [storageKey]
  );

  const value = useMemo(
    () => ({ theme, setTheme, resolvedTheme }),
    [theme, setTheme, resolvedTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
