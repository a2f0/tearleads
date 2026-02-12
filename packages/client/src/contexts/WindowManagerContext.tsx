import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react';
import { MOBILE_BREAKPOINT } from '@/constants/breakpoints';
import { generateUniqueId } from '@/lib/utils';
import {
  loadWindowDimensions,
  saveWindowDimensions
} from '@/lib/windowDimensionsStorage';
import { getPreserveWindowState } from '@/lib/windowStatePreference';

// AGENT GUARDRAIL: When adding a new WindowType, ensure parity across:
// - WindowRenderer.tsx (add entry in the window component map)
// - Home.tsx PATH_TO_WINDOW_TYPE (enable opening from desktop icons)
// - constants/windowPaths.ts WINDOW_PATHS (enable opening from sidebar double-click)
// - Create corresponding window component in components/<type>-window/
export type WindowType =
  | 'notes'
  | 'console'
  | 'settings'
  | 'files'
  | 'tables'
  | 'debug'
  | 'help'
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
  | 'admin-redis'
  | 'admin-postgres'
  | 'admin-groups'
  | 'admin-users'
  | 'admin-organizations'
  | 'cache-storage'
  | 'local-storage'
  | 'sync'
  | 'vfs'
  | 'classic'
  | 'backup'
  | 'mls-chat'
  | 'search'
  | 'calendar';

export interface WindowOpenRequestPayloads {
  contacts: { contactId?: string; groupId?: string };
  notes: { noteId: string };
  documents: { documentId: string };
  photos: { photoId?: string; albumId?: string };
  files: { fileId: string };
  audio: { audioId?: string; playlistId?: string };
  videos: { videoId?: string; playlistId?: string };
  email: {
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body?: string;
  };
}

export type WindowOpenRequests = {
  [K in keyof WindowOpenRequestPayloads]?: WindowOpenRequestPayloads[K] & {
    requestId: number;
  };
};

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
  title?: string;
}

interface WindowManagerContextValue {
  windows: WindowInstance[];
  openWindow: (type: WindowType, id?: string) => string;
  requestWindowOpen: <K extends keyof WindowOpenRequestPayloads>(
    type: K,
    payload: WindowOpenRequestPayloads[K]
  ) => void;
  windowOpenRequests: WindowOpenRequests;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string, dimensions?: WindowDimensions) => void;
  restoreWindow: (id: string) => void;
  updateWindowDimensions: (id: string, dimensions: WindowDimensions) => void;
  saveWindowDimensionsForType: (
    type: WindowType,
    dimensions: WindowDimensions
  ) => void;
  renameWindow: (id: string, title: string) => void;
  isWindowOpen: (type: WindowType, id?: string) => boolean;
  getWindow: (id: string) => WindowInstance | undefined;
}

type WindowManagerActions = Omit<
  WindowManagerContextValue,
  'windows' | 'windowOpenRequests' | 'isWindowOpen' | 'getWindow'
>;

export type { WindowManagerActions };

const WindowManagerContext = createContext<WindowManagerContextValue | null>(
  null
);
const WindowManagerActionsContext = createContext<WindowManagerActions | null>(
  null
);
const WindowOpenRequestsContext = createContext<WindowOpenRequests | null>(
  null
);

const NOOP_WINDOW_MANAGER_ACTIONS: WindowManagerActions = {
  openWindow: () => '',
  requestWindowOpen: () => {},
  closeWindow: () => {},
  focusWindow: () => {},
  minimizeWindow: () => {},
  restoreWindow: () => {},
  updateWindowDimensions: () => {},
  saveWindowDimensionsForType: () => {},
  renameWindow: () => {}
};

const BASE_Z_INDEX = 100;
const DEFAULT_WINDOW_WIDTH_RATIO = 0.51;
const DEFAULT_WINDOW_ASPECT_RATIO = 16 / 10;
const DEFAULT_WINDOW_MIN_WIDTH = 480;
const DEFAULT_WINDOW_MIN_HEIGHT = 320;
const DEFAULT_WINDOW_HORIZONTAL_MARGIN = 120;
const DEFAULT_WINDOW_VERTICAL_MARGIN = 160;
const DEFAULT_WINDOW_CASCADE_OFFSET_X = 36;
const DEFAULT_WINDOW_CASCADE_OFFSET_Y = 28;

interface WindowManagerProviderProps {
  children: ReactNode;
}

function getDefaultLandscapeWindowDimensions(): WindowDimensions | undefined {
  if (
    typeof window === 'undefined' ||
    window.innerWidth < MOBILE_BREAKPOINT ||
    window.innerHeight <= 0
  ) {
    return undefined;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.max(
    DEFAULT_WINDOW_MIN_WIDTH,
    viewportWidth - DEFAULT_WINDOW_HORIZONTAL_MARGIN
  );
  const maxHeight = Math.max(
    DEFAULT_WINDOW_MIN_HEIGHT,
    viewportHeight - DEFAULT_WINDOW_VERTICAL_MARGIN
  );

  let width = Math.max(
    DEFAULT_WINDOW_MIN_WIDTH,
    Math.min(maxWidth, Math.round(viewportWidth * DEFAULT_WINDOW_WIDTH_RATIO))
  );
  const height = Math.max(
    DEFAULT_WINDOW_MIN_HEIGHT,
    Math.min(maxHeight, Math.round(width / DEFAULT_WINDOW_ASPECT_RATIO))
  );

  if (height === maxHeight) {
    width = Math.max(
      DEFAULT_WINDOW_MIN_WIDTH,
      Math.min(maxWidth, Math.round(height * DEFAULT_WINDOW_ASPECT_RATIO))
    );
  }

  const x = Math.max(0, Math.round((viewportWidth - width) / 2));
  const y = Math.max(0, Math.round((viewportHeight - height) / 2));

  return { width, height, x, y };
}

function getCascadedWindowDimensions(
  dimensions: WindowDimensions,
  currentWindows: WindowInstance[]
): WindowDimensions {
  if (
    typeof window === 'undefined' ||
    window.innerWidth < MOBILE_BREAKPOINT ||
    currentWindows.length === 0
  ) {
    return dimensions;
  }

  const topWindow = currentWindows.reduce((highest, candidate) =>
    candidate.zIndex > highest.zIndex ? candidate : highest
  );
  const anchor = topWindow.dimensions;
  if (!anchor) {
    return dimensions;
  }

  const maxX = Math.max(0, window.innerWidth - dimensions.width);
  const maxY = Math.max(0, window.innerHeight - dimensions.height);
  const x = Math.max(
    0,
    Math.min(maxX, anchor.x + DEFAULT_WINDOW_CASCADE_OFFSET_X)
  );
  const y = Math.max(
    0,
    Math.min(maxY, anchor.y + DEFAULT_WINDOW_CASCADE_OFFSET_Y)
  );

  return {
    ...dimensions,
    x,
    y
  };
}

export function WindowManagerProvider({
  children
}: WindowManagerProviderProps) {
  const [windows, setWindows] = useState<WindowInstance[]>([]);
  const [windowOpenRequests, setWindowOpenRequests] =
    useState<WindowOpenRequests>({});
  const requestCounterRef = useRef(0);
  const windowsRef = useRef<WindowInstance[]>(windows);
  windowsRef.current = windows;

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
        : windowsRef.current.find((window) => window.type === type);
      let resolvedId = existingWindow?.id ?? id;

      // Load saved dimensions for this window type if preservation is enabled
      const savedDimensions = getPreserveWindowState()
        ? loadWindowDimensions(type)
        : null;
      const defaultDimensions = getDefaultLandscapeWindowDimensions();

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

        const initialDimensions =
          savedDimensions ??
          (defaultDimensions
            ? getCascadedWindowDimensions(defaultDimensions, prev)
            : undefined);
        const nextZIndex = getNextZIndex(prev);
        return [
          ...prev,
          {
            id,
            type,
            zIndex: nextZIndex,
            isMinimized: false,
            ...(initialDimensions && { dimensions: initialDimensions })
          }
        ];
      });

      return resolvedId;
    },
    [getNextZIndex]
  );

  const requestWindowOpen = useCallback(
    <K extends keyof WindowOpenRequestPayloads>(
      type: K,
      payload: WindowOpenRequestPayloads[K]
    ) => {
      requestCounterRef.current += 1;
      const requestId = requestCounterRef.current;
      setWindowOpenRequests((prev) => ({
        ...prev,
        [type]: { ...payload, requestId }
      }));
    },
    []
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

  const renameWindow = useCallback((id: string, title: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, title } : w)));
  }, []);

  const saveWindowDimensionsForType = useCallback(
    (type: WindowType, dimensions: WindowDimensions) => {
      const { width, height, x, y } = dimensions;
      if (!getPreserveWindowState()) {
        return;
      }
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
      requestWindowOpen,
      windowOpenRequests,
      closeWindow,
      focusWindow,
      minimizeWindow,
      restoreWindow,
      updateWindowDimensions,
      saveWindowDimensionsForType,
      renameWindow,
      isWindowOpen,
      getWindow
    }),
    [
      windows,
      openWindow,
      requestWindowOpen,
      windowOpenRequests,
      closeWindow,
      focusWindow,
      minimizeWindow,
      restoreWindow,
      updateWindowDimensions,
      saveWindowDimensionsForType,
      renameWindow,
      isWindowOpen,
      getWindow
    ]
  );

  const actionsValue = useMemo<WindowManagerActions>(
    () => ({
      openWindow,
      requestWindowOpen,
      closeWindow,
      focusWindow,
      minimizeWindow,
      restoreWindow,
      updateWindowDimensions,
      saveWindowDimensionsForType,
      renameWindow
    }),
    [
      openWindow,
      requestWindowOpen,
      closeWindow,
      focusWindow,
      minimizeWindow,
      restoreWindow,
      updateWindowDimensions,
      saveWindowDimensionsForType,
      renameWindow
    ]
  );

  return (
    <WindowManagerActionsContext.Provider value={actionsValue}>
      <WindowOpenRequestsContext.Provider value={windowOpenRequests}>
        <WindowManagerContext.Provider value={value}>
          {children}
        </WindowManagerContext.Provider>
      </WindowOpenRequestsContext.Provider>
    </WindowManagerActionsContext.Provider>
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

export function useWindowManagerActions(): WindowManagerActions {
  const context = useContext(WindowManagerActionsContext);
  return context ?? NOOP_WINDOW_MANAGER_ACTIONS;
}

export function useWindowOpenRequest<K extends keyof WindowOpenRequestPayloads>(
  type: K
): (WindowOpenRequestPayloads[K] & { requestId: number }) | undefined {
  const context = useContext(WindowOpenRequestsContext);
  if (context === null) {
    throw new Error(
      'useWindowOpenRequest must be used within a WindowManagerProvider'
    );
  }
  return context[type];
}
