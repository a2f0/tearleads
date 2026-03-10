import { createContext, useContext } from 'react';

export interface WindowSidebarContextValue {
  closeSidebar: () => void;
  isMobileDrawer: boolean;
}

const WindowSidebarContext = createContext<WindowSidebarContextValue>({
  closeSidebar: () => {},
  isMobileDrawer: false
});

export function WindowSidebarProvider({
  children,
  value
}: {
  children: React.ReactNode;
  value: WindowSidebarContextValue;
}) {
  return (
    <WindowSidebarContext.Provider value={value}>
      {children}
    </WindowSidebarContext.Provider>
  );
}

export function useWindowSidebar(): WindowSidebarContextValue {
  return useContext(WindowSidebarContext);
}
