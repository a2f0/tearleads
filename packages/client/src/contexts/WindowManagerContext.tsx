import {
  type WindowInstance as BaseWindowInstance,
  WindowManagerProvider as BaseWindowManagerProvider,
  generateUniqueId,
  getDefaultDesktopWindowDimensions,
  getPreserveWindowState,
  loadWindowDimensions,
  saveWindowDimensions,
  useWindowManager as useBaseWindowManager,
  type WindowDimensions
} from '@tearleads/window-manager';
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
import type { HelpDocId } from '@/constants/help';

// AGENT GUARDRAIL: When adding a new WindowType, ensure parity across:
// - WindowRenderer.tsx (add entry in the window component map)
// - Home.tsx PATH_TO_WINDOW_TYPE (enable opening from desktop icons)
// - constants/windowPaths.ts WINDOW_PATHS (enable opening from sidebar double-click)
// - Create corresponding window component in components/<type>-window/
const WINDOW_TYPES = [
  'notes',
  'console',
  'settings',
  'files',
  'tables',
  'debug',
  'help',
  'documents',
  'email',
  'contacts',
  'photos',
  'camera',
  'videos',
  'keychain',
  'wallet',
  'sqlite',
  'opfs',
  'ai',
  'analytics',
  'audio',
  'models',
  'admin',
  'admin-redis',
  'admin-postgres',
  'admin-groups',
  'admin-users',
  'admin-organizations',
  'cache-storage',
  'local-storage',
  'sync',
  'vfs',
  'classic',
  'backup',
  'mls-chat',
  'search',
  'calendar',
  'businesses',
  'vehicles',
  'health',
  'notification-center'
] as const;

const WINDOW_TYPE_SET = new Set<string>(WINDOW_TYPES);

function isWindowType(type: string): type is WindowType {
  return WINDOW_TYPE_SET.has(type);
}

export type WindowType = (typeof WINDOW_TYPES)[number];

export interface WindowOpenRequestPayloads {
  contacts: { contactId?: string; groupId?: string };
  notes: { noteId: string };
  documents: { documentId: string };
  photos: { photoId?: string; albumId?: string };
  files: { fileId: string };
  audio: { audioId?: string; playlistId?: string; albumId?: string };
  videos: { videoId?: string; playlistId?: string };
  email: {
    emailId?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body?: string;
  };
  ai: { conversationId?: string };
  help: { helpDocId?: HelpDocId };
}

type WindowOpenRequests = {
  [K in keyof WindowOpenRequestPayloads]?: WindowOpenRequestPayloads[K] & {
    requestId: number;
  };
};

export interface WindowInstance extends Omit<BaseWindowInstance, 'type'> {
  type: WindowType;
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

interface WindowManagerProviderProps {
  children: ReactNode;
}

function WindowManagerAdapterProvider({ children }: { children: ReactNode }) {
  const baseWindowManager = useBaseWindowManager();
  const [windowOpenRequests, setWindowOpenRequests] =
    useState<WindowOpenRequests>({});
  const requestCounterRef = useRef(0);

  const windows = useMemo<WindowInstance[]>(
    () =>
      baseWindowManager.windows.flatMap((window) => {
        if (!isWindowType(window.type)) {
          return [];
        }
        return [{ ...window, type: window.type }];
      }),
    [baseWindowManager.windows]
  );

  const openWindow = useCallback(
    (type: WindowType, id?: string) => baseWindowManager.openWindow(type, id),
    [baseWindowManager]
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

  const closeWindow = useCallback(
    (id: string) => baseWindowManager.closeWindow(id),
    [baseWindowManager]
  );

  const focusWindow = useCallback(
    (id: string) => baseWindowManager.focusWindow(id),
    [baseWindowManager]
  );

  const minimizeWindow = useCallback(
    (id: string, dimensions?: WindowDimensions) =>
      baseWindowManager.minimizeWindow(id, dimensions),
    [baseWindowManager]
  );

  const restoreWindow = useCallback(
    (id: string) => baseWindowManager.restoreWindow(id),
    [baseWindowManager]
  );

  const updateWindowDimensions = useCallback(
    (id: string, dimensions: WindowDimensions) =>
      baseWindowManager.updateWindowDimensions(id, dimensions),
    [baseWindowManager]
  );

  const saveWindowDimensionsForType = useCallback(
    (type: WindowType, dimensions: WindowDimensions) =>
      baseWindowManager.saveWindowDimensionsForType(type, dimensions),
    [baseWindowManager]
  );

  const renameWindow = useCallback(
    (id: string, title: string) => baseWindowManager.renameWindow(id, title),
    [baseWindowManager]
  );

  const isWindowOpen = useCallback(
    (type: WindowType, id?: string) => baseWindowManager.isWindowOpen(type, id),
    [baseWindowManager]
  );

  const getWindow = useCallback(
    (id: string): WindowInstance | undefined => {
      const window = baseWindowManager.getWindow(id);
      if (!window || !isWindowType(window.type)) {
        return undefined;
      }
      return { ...window, type: window.type };
    },
    [baseWindowManager]
  );

  const value = useMemo<WindowManagerContextValue>(
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

export function WindowManagerProvider({
  children
}: WindowManagerProviderProps) {
  const loadDimensionsForType = useCallback((type: string) => {
    if (!isWindowType(type)) {
      return null;
    }
    return loadWindowDimensions(type);
  }, []);

  const saveDimensionsForType = useCallback(
    (type: string, dimensions: WindowDimensions) => {
      if (!isWindowType(type)) {
        return;
      }
      saveWindowDimensions(type, dimensions);
    },
    []
  );

  const resolveInitialDimensions = useCallback(
    ({
      savedDimensions,
      currentWindows
    }: {
      savedDimensions: WindowDimensions | null;
      currentWindows: BaseWindowInstance[];
    }): WindowDimensions | undefined => {
      if (savedDimensions) {
        return savedDimensions;
      }
      return getDefaultDesktopWindowDimensions({
        mobileBreakpoint: MOBILE_BREAKPOINT,
        currentWindows
      });
    },
    []
  );

  return (
    <BaseWindowManagerProvider
      loadDimensions={loadDimensionsForType}
      saveDimensions={saveDimensionsForType}
      shouldPreserveState={getPreserveWindowState}
      createWindowId={generateUniqueId}
      resolveInitialDimensions={resolveInitialDimensions}
    >
      <WindowManagerAdapterProvider>{children}</WindowManagerAdapterProvider>
    </BaseWindowManagerProvider>
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
