import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export interface WindowEntry {
  id: string;
  title: string;
  initialX: number;
  initialY: number;
  minimized: boolean;
  zIndex: number;
  component?: React.ComponentType;
}

interface WindowStateContextValue {
  // windows is the raw useState array — stable and cheap to iterate for
  // rendering lists. windowMap is derived via useMemo for O(1) lookups by ID.
  // Both are already memoized so neither adds redundant computation.
  windows: WindowEntry[];
  windowMap: Map<string, WindowEntry>;
  create: (
    title: string,
    x: number,
    y: number,
    component?: React.ComponentType,
  ) => string;
  close: (id: string) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  updateTitle: (id: string, title: string) => void;
  moveForward: (id: string) => void;
  moveBackward: (id: string) => void;
  bringToFront: (id: string) => void;
}

const WindowStateContext = createContext<WindowStateContextValue | null>(null);

function findAdjacentWindow(
  windows: WindowEntry[],
  target: WindowEntry,
  direction: "forward" | "backward",
) {
  let candidate: WindowEntry | null = null;

  for (const window of windows) {
    if (direction === "forward") {
      if (window.zIndex <= target.zIndex) continue;
      if (!candidate || window.zIndex < candidate.zIndex) {
        candidate = window;
      }
      continue;
    }

    if (window.zIndex >= target.zIndex) continue;
    if (!candidate || window.zIndex > candidate.zIndex) {
      candidate = window;
    }
  }

  return candidate;
}

function createWindowEntry(
  id: string,
  title: string,
  x: number,
  y: number,
  zIndex: number,
  component?: React.ComponentType,
): WindowEntry {
  return {
    id,
    title,
    initialX: x,
    initialY: y,
    minimized: false,
    zIndex,
    ...(component ? { component } : {}),
  };
}

function updateWindowFlag(
  windows: WindowEntry[],
  id: string,
  patch: Pick<WindowEntry, "minimized">,
) {
  return windows.map((windowEntry) =>
    windowEntry.id === id ? { ...windowEntry, ...patch } : windowEntry,
  );
}

function updateWindowTitle(windows: WindowEntry[], id: string, title: string) {
  return windows.map((windowEntry) =>
    windowEntry.id === id ? { ...windowEntry, title } : windowEntry,
  );
}

function swapWindowZIndexes(
  windows: WindowEntry[],
  id: string,
  direction: "forward" | "backward",
) {
  const target = windows.find((windowEntry) => windowEntry.id === id);
  if (!target) {
    return windows;
  }

  const swapWith = findAdjacentWindow(windows, target, direction);
  if (!swapWith) {
    return windows;
  }

  return windows.map((windowEntry) => {
    if (windowEntry.id === target.id) {
      return { ...windowEntry, zIndex: swapWith.zIndex };
    }
    if (windowEntry.id === swapWith.id) {
      return { ...windowEntry, zIndex: target.zIndex };
    }
    return windowEntry;
  });
}

function bringWindowToFront(windows: WindowEntry[], id: string) {
  const target = windows.find((windowEntry) => windowEntry.id === id);
  if (!target) {
    return windows;
  }

  const topZIndex = windows.reduce(
    (maxZIndex, windowEntry) => Math.max(maxZIndex, windowEntry.zIndex),
    0,
  );
  if (target.zIndex === topZIndex) {
    return windows;
  }

  return windows.map((windowEntry) => {
    if (windowEntry.id === target.id) {
      return { ...windowEntry, zIndex: topZIndex };
    }
    if (windowEntry.zIndex > target.zIndex) {
      return { ...windowEntry, zIndex: windowEntry.zIndex - 1 };
    }
    return windowEntry;
  });
}

export function WindowStateProvider({ children }: PropsWithChildren) {
  const [windows, setWindows] = useState<WindowEntry[]>([]);
  const counter = useRef(0);

  const create = useCallback(
    (title: string, x: number, y: number, component?: React.ComponentType) => {
      const id = String(++counter.current);
      setWindows((prev) => {
        const maxZ = prev.reduce((m, w) => Math.max(m, w.zIndex), 0);
        return [
          ...prev,
          createWindowEntry(id, title, x, y, maxZ + 1, component),
        ];
      });
      return id;
    },
    [],
  );

  const close = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const minimize = useCallback((id: string) => {
    setWindows((prev) => updateWindowFlag(prev, id, { minimized: true }));
  }, []);

  const restore = useCallback((id: string) => {
    setWindows((prev) => updateWindowFlag(prev, id, { minimized: false }));
  }, []);

  const updateTitle = useCallback((id: string, title: string) => {
    setWindows((prev) => updateWindowTitle(prev, id, title));
  }, []);

  const moveForward = useCallback((id: string) => {
    setWindows((prev) => swapWindowZIndexes(prev, id, "forward"));
  }, []);

  const moveBackward = useCallback((id: string) => {
    setWindows((prev) => swapWindowZIndexes(prev, id, "backward"));
  }, []);

  const bringToFront = useCallback((id: string) => {
    setWindows((prev) => bringWindowToFront(prev, id));
  }, []);

  const windowMap = useMemo(
    () => new Map(windows.map((w) => [w.id, w])),
    [windows],
  );

  const value = useMemo(
    () => ({
      windows,
      windowMap,
      create,
      close,
      minimize,
      restore,
      updateTitle,
      moveForward,
      moveBackward,
      bringToFront,
    }),
    [
      windows,
      windowMap,
      create,
      close,
      minimize,
      restore,
      updateTitle,
      moveForward,
      moveBackward,
      bringToFront,
    ],
  );

  return (
    <WindowStateContext.Provider value={value}>
      {children}
    </WindowStateContext.Provider>
  );
}

export function useWindowState() {
  const ctx = useContext(WindowStateContext);
  if (!ctx) throw new Error("useWindowState requires WindowStateProvider");
  return ctx;
}
