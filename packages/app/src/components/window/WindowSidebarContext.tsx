import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface WindowSidebarContextValue {
  sidebar: ReactNode;
  setSidebar: (node: ReactNode) => void;
}

const WindowSidebarContext = createContext<WindowSidebarContextValue>({
  sidebar: null,
  setSidebar: () => {},
});

export function WindowSidebarProvider({ children }: PropsWithChildren) {
  const [sidebar, setSidebarState] = useState<ReactNode>(null);
  const setSidebar = useCallback((node: ReactNode) => {
    setSidebarState(node);
  }, []);
  const value = useMemo(() => ({ sidebar, setSidebar }), [sidebar, setSidebar]);
  return (
    <WindowSidebarContext.Provider value={value}>
      {children}
    </WindowSidebarContext.Provider>
  );
}

export function useWindowSidebar() {
  return useContext(WindowSidebarContext);
}

export function useRegisteredWindowSidebar({
  enabled = true,
  setSidebar,
  sidebar,
}: {
  enabled?: boolean;
  setSidebar: (node: ReactNode) => void;
  sidebar: ReactNode;
}) {
  const setSidebarRef = useRef(setSidebar);
  setSidebarRef.current = setSidebar;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    setSidebar(sidebar);
  }, [enabled, setSidebar, sidebar]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return () => setSidebarRef.current(null);
  }, [enabled]);
}
