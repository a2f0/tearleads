import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
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
  return (
    <WindowSidebarContext.Provider value={{ sidebar, setSidebar }}>
      {children}
    </WindowSidebarContext.Provider>
  );
}

export function useWindowSidebar() {
  return useContext(WindowSidebarContext);
}
