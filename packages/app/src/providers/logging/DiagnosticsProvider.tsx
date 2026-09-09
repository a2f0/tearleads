import { createContext, type PropsWithChildren, useContext } from "react";
import type { AppDiagnostics, DiagnosticArea } from "../../host/AppDiagnostics";

const DiagnosticsContext = createContext<AppDiagnostics | undefined>(undefined);
export const DiagnosticAreaContext = createContext<DiagnosticArea>("app");

export function DiagnosticsProvider({
  children,
  value,
}: PropsWithChildren<{
  value: AppDiagnostics | undefined;
}>) {
  return (
    <DiagnosticsContext.Provider value={value}>
      {children}
    </DiagnosticsContext.Provider>
  );
}

export function useDiagnostics() {
  return useContext(DiagnosticsContext);
}
