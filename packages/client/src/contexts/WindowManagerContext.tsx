import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from 'react';
import { generateUniqueId } from '@/lib/utils';
import {
  loadWindowDimensions,
  saveWindowDimensions
} from '@/lib/windowDimensionsStorage';

// AGENT GUARDRAIL: When adding a new WindowType, ensure parity across:
// - WindowRenderer.tsx (add case to render the window component)
// - Home.tsx PATH_TO_WINDOW_TYPE (enable opening from desktop icons)
// - Sidebar.tsx WINDOW_PATHS (enable opening from sidebar double-click)
// - Create corresponding window component in components/<type>-window/
export type WindowType =
  | 'notes'
  | 'console'
  | 'settings'
  | 'files'
  | 'tables'
  | 'debug'
  | 'documents'
  | 'email'
  | 'contacts'
  | 'photos'
  | 'videos'
  | 'keychain'
  | 'sqlite'
  | 'opfs'
  | 'chat'
  | 'analytics'
  | 'audio'
  | 'models'
  | 'admin'
  | 'cache-storage'
  | 'local-storage';

export interface WindowDimensions {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized?: boolean;
  preMaximizeDimensions?: {
    width: number;
    height: number;
    x: number;
    y: number;
  };
}

export interface WindowInstance {
  id: string;
  type: WindowType;
  zIndex: number;
  isMinimized: boolean;
  dimensions?: WindowDimensions;
}

interface WindowManagerContextValue {
  windows: WindowInstance[];
  openWindow: (type: WindowType, id?: string) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string, dimensions?: WindowDimensions) => void;
  restoreWindow: (id: string) => void;
  updateWindowDimensions: (id: string, dimensions: WindowDimensions) => void;
  saveWindowDimensionsForType: (
    type: WindowType,
    dimensions: WindowDimensions
  ) => void;
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

  const getNextZIndex = useCallback((currentWindows: WindowInstance[]) => {
    if (currentWindows.length === 0) {
      return BASE_Z_INDEX;
    }
    return Math.max(...currentWindows.map((w) => w.zIndex)) + 1;
  }, []);

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const focusWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const windowToFocus = prev.find((w) => w.id === id);
      if (!windowToFocus) return prev;

      const maxZIndex = Math.max(...prev.map((w) => w.zIndex));
      if (windowToFocus.zIndex === maxZIndex && !windowToFocus.isMinimized) {
        return prev;
      }

      return prev.map((w) =>
        w.id === id ? { ...w, zIndex: maxZIndex + 1, isMinimized: false } : w
      );
    });
  }, []);

  const openWindow = useCallback(
    (type: WindowType, customId?: string): string => {
      const id = customId ?? generateUniqueId(type);
      const existingWindow = customId
        ? undefined
        : windows.find((window) => window.type === type);
      const resolvedId = existingWindow?.id ?? id;

      // Load saved dimensions for this window type
      const savedDimensions = loadWindowDimensions(type);

      setWindows((prev) => {
        if (!customId) {
          const existingByType = prev.find((w) => w.type === type);
          if (existingByType) {
            resolvedId = existingByType.id;
            const nextZIndex = getNextZIndex(prev);
            return prev.map((w) =>
              w.id === existingByType.id
                ? { ...w, isMinimized: false, zIndex: nextZIndex }
                : w
            );
          }
        }

        const existing = prev.find((w) => w.id === id);
        if (existing) {
          resolvedId = existing.id;
          return prev;
        }

        const nextZIndex = getNextZIndex(prev);
        return [
          ...prev,
          {
            id,
            type,
            zIndex: nextZIndex,
            isMinimized: false,
            ...(savedDimensions && { dimensions: savedDimensions })
          }
        ];
      });

      return resolvedId;
    },
    [getNextZIndex, windows]
  );

  const minimizeWindow = useCallback(
    (id: string, dimensions?: WindowDimensions) => {
      setWindows((prev) =>
        prev.map((w) => {
          if (w.id !== id) return w;
          const newDimensions = dimensions ?? w.dimensions;
          return newDimensions
            ? { ...w, isMinimized: true, dimensions: newDimensions }
            : { ...w, isMinimized: true };
        })
      );
    },
    []
  );

  const restoreWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const maxZIndex = Math.max(...prev.map((w) => w.zIndex));
      return prev.map((w) =>
        w.id === id ? { ...w, isMinimized: false, zIndex: maxZIndex + 1 } : w
      );
    });
  }, []);

  const updateWindowDimensions = useCallback(
    (id: string, dimensions: WindowDimensions) => {
      setWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, dimensions } : w))
      );
    },
    []
  );

  const saveWindowDimensionsForType = useCallback(
    (type: WindowType, dimensions: WindowDimensions) => {
      const { width, height, x, y } = dimensions;
      saveWindowDimensions(type, { width, height, x, y });
    },
    []
  );

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
      minimizeWindow,
      restoreWindow,
      updateWindowDimensions,
      saveWindowDimensionsForType,
      isWindowOpen,
      getWindow
    }),
    [
      windows,
      openWindow,
      closeWindow,
      focusWindow,
      minimizeWindow,
      restoreWindow,
      updateWindowDimensions,
      saveWindowDimensionsForType,
      isWindowOpen,
      getWindow
    ]
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
