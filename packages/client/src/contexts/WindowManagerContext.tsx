import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from 'react';

export type WindowType = 'notes';

export interface WindowInstance {
  id: string;
  type: WindowType;
  zIndex: number;
}

interface WindowManagerContextValue {
  windows: WindowInstance[];
  openWindow: (type: WindowType, id?: string) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  isWindowOpen: (type: WindowType, id?: string) => boolean;
  getWindow: (id: string) => WindowInstance | undefined;
}

const WindowManagerContext = createContext<WindowManagerContextValue | null>(
  null
);

const BASE_Z_INDEX = 100;

interface WindowManagerProviderProps {
  children: ReactNode;
}

export function WindowManagerProvider({
  children
}: WindowManagerProviderProps) {
  const [windows, setWindows] = useState<WindowInstance[]>([]);
  const [nextZIndex, setNextZIndex] = useState(BASE_Z_INDEX);

  const openWindow = useCallback(
    (type: WindowType, customId?: string): string => {
      const id = customId ?? `${type}-${Date.now()}`;

      setWindows((prev) => {
        const existing = prev.find((w) => w.id === id);
        if (existing) {
          return prev;
        }

        return [
          ...prev,
          {
            id,
            type,
            zIndex: nextZIndex
          }
        ];
      });

      setNextZIndex((prev) => prev + 1);
      return id;
    },
    [nextZIndex]
  );

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const focusWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const windowToFocus = prev.find((w) => w.id === id);
      if (!windowToFocus) return prev;

      const maxZIndex = Math.max(...prev.map((w) => w.zIndex));
      if (windowToFocus.zIndex === maxZIndex) return prev;

      return prev.map((w) =>
        w.id === id ? { ...w, zIndex: maxZIndex + 1 } : w
      );
    });
    setNextZIndex((prev) => prev + 1);
  }, []);

  const isWindowOpen = useCallback(
    (type: WindowType, id?: string): boolean => {
      if (id) {
        return windows.some((w) => w.id === id);
      }
      return windows.some((w) => w.type === type);
    },
    [windows]
  );

  const getWindow = useCallback(
    (id: string): WindowInstance | undefined => {
      return windows.find((w) => w.id === id);
    },
    [windows]
  );

  const value = useMemo(
    () => ({
      windows,
      openWindow,
      closeWindow,
      focusWindow,
      isWindowOpen,
      getWindow
    }),
    [windows, openWindow, closeWindow, focusWindow, isWindowOpen, getWindow]
  );

  return (
    <WindowManagerContext.Provider value={value}>
      {children}
    </WindowManagerContext.Provider>
  );
}

export function useWindowManager(): WindowManagerContextValue {
  const context = useContext(WindowManagerContext);
  if (!context) {
    throw new Error(
      'useWindowManager must be used within a WindowManagerProvider'
    );
  }
  return context;
}
