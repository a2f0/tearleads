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

export function WindowStateProvider({ children }: PropsWithChildren) {
  const [windows, setWindows] = useState<WindowEntry[]>([]);
  const counter = useRef(0);

  const create = useCallback(
    (title: string, x: number, y: number, component?: React.ComponentType) => {
      const id = String(++counter.current);
      setWindows((prev) => {
        const maxZ = prev.reduce((m, w) => Math.max(m, w.zIndex), 0);
        const entry: WindowEntry = {
          id,
          title,
          initialX: x,
          initialY: y,
          minimized: false,
          zIndex: maxZ + 1,
          ...(component && { component }),
        };
        return [...prev, entry];
      });
      return id;
    },
    [],
  );

  const close = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const minimize = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
    );
  }, []);

  const restore = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: false } : w)),
    );
  }, []);

  const updateTitle = useCallback((id: string, title: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, title } : w)));
  }, []);

  const moveForward = useCallback((id: string) => {
    setWindows((prev) => {
      const target = prev.find((w) => w.id === id);
      if (!target) return prev;
      const swapWith = findAdjacentWindow(prev, target, "forward");
      if (!swapWith) return prev;
      return prev.map((w) => {
        if (w.id === target.id) return { ...w, zIndex: swapWith.zIndex };
        if (w.id === swapWith.id) return { ...w, zIndex: target.zIndex };
        return w;
      });
    });
  }, []);

  const moveBackward = useCallback((id: string) => {
    setWindows((prev) => {
      const target = prev.find((w) => w.id === id);
      if (!target) return prev;
      const swapWith = findAdjacentWindow(prev, target, "backward");
      if (!swapWith) return prev;
      return prev.map((w) => {
        if (w.id === target.id) return { ...w, zIndex: swapWith.zIndex };
        if (w.id === swapWith.id) return { ...w, zIndex: target.zIndex };
        return w;
      });
    });
  }, []);

  const bringToFront = useCallback((id: string) => {
    setWindows((prev) => {
      const target = prev.find((w) => w.id === id);
      if (!target) return prev;

      const topZIndex = prev.reduce((max, w) => Math.max(max, w.zIndex), 0);
      if (target.zIndex === topZIndex) return prev;

      return prev.map((w) => {
        if (w.id === target.id) return { ...w, zIndex: topZIndex };
        if (w.zIndex > target.zIndex) return { ...w, zIndex: w.zIndex - 1 };
        return w;
      });
    });
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
