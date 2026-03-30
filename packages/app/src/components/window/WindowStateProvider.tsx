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
}

const WindowStateContext = createContext<WindowStateContextValue | null>(null);

export function WindowStateProvider({ children }: PropsWithChildren) {
  const [windows, setWindows] = useState<WindowEntry[]>([]);
  const counter = useRef(0);

  const create = useCallback(
    (title: string, x: number, y: number, component?: React.ComponentType) => {
      const id = String(++counter.current);
      const entry: WindowEntry = {
        id,
        title,
        initialX: x,
        initialY: y,
        minimized: false,
        ...(component && { component }),
      };
      setWindows((prev) => [...prev, entry]);
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
    }),
    [windows, windowMap, create, close, minimize, restore, updateTitle],
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
