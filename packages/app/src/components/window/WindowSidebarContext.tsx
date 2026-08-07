import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
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
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const value = useMemo(() => ({ sidebar, setSidebar }), [sidebar]);
  return (
    <WindowSidebarContext.Provider value={value}>
      {children}
    </WindowSidebarContext.Provider>
  );
}

// `sidebar` is a ReactNode, so `false`/`null`/`undefined` all mean "no
// sidebar" while renderable falsy values like `0` or `""` do not.
export function hasWindowSidebar(sidebar: ReactNode): boolean {
  return sidebar !== null && sidebar !== undefined && sidebar !== false;
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
