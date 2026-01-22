import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';

interface ScreensaverContextValue {
  isActive: boolean;
  activate: () => void;
  deactivate: () => void;
}

const ScreensaverContext = createContext<ScreensaverContextValue | null>(null);

export function useScreensaver(): ScreensaverContextValue {
  const context = useContext(ScreensaverContext);
  if (!context) {
    throw new Error('useScreensaver must be used within a ScreensaverProvider');
  }
  return context;
}

interface ScreensaverProviderProps {
  children: React.ReactNode;
}

export function ScreensaverProvider({ children }: ScreensaverProviderProps) {
  const [isActive, setIsActive] = useState(false);

  const activate = useCallback(() => {
    setIsActive(true);
  }, []);

  const deactivate = useCallback(() => {
    setIsActive(false);
  }, []);

  // Global keyboard shortcut: Cmd+L (Mac) or Ctrl+L (Windows/Linux)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        activate();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activate]);

  const value = useMemo(
    () => ({ isActive, activate, deactivate }),
    [isActive, activate, deactivate]
  );

  return (
    <ScreensaverContext.Provider value={value}>
      {children}
    </ScreensaverContext.Provider>
  );
}
