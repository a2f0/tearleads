import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface WindowEntry {
  id: string;
  title: string;
  minimized: boolean;
}

interface WindowStateContextValue {
  windows: WindowEntry[];
  register: (id: string, title: string) => void;
  unregister: (id: string) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
}

const WindowStateContext = createContext<WindowStateContextValue | null>(null);

export function WindowStateProvider({ children }: PropsWithChildren) {
  const [windows, setWindows] = useState<WindowEntry[]>([]);

  const register = useCallback((id: string, title: string) => {
    setWindows((prev) => {
      const index = prev.findIndex((w) => w.id === id);
      if (index === -1) {
        return [...prev, { id, title, minimized: false }];
      }
      const existing = prev[index] as WindowEntry;
      if (existing.title === title) {
        return prev;
      }
      return prev.map((w, i) => (i === index ? { ...w, title } : w));
    });
  }, []);

  const unregister = useCallback((id: string) => {
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

  const value = useMemo(
    () => ({ windows, register, unregister, minimize, restore }),
    [windows, register, unregister, minimize, restore],
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
