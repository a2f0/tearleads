import { createContext, type PropsWithChildren, useContext } from "react";
import type { AppHostConfig } from "./AppHostConfig";

const AppHostConfigContext = createContext<AppHostConfig | null>(null);

export function AppHostConfigProvider({
  children,
  value,
}: PropsWithChildren<{ value: AppHostConfig }>) {
  return (
    <AppHostConfigContext.Provider value={value}>
      {children}
    </AppHostConfigContext.Provider>
  );
}

export function useAppHostConfig() {
  const context = useContext(AppHostConfigContext);
  if (!context) {
    throw new Error(
      "useAppHostConfig must be used within an AppHostConfigProvider.",
    );
  }
  return context;
}
