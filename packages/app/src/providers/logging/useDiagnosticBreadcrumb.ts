import { useCallback, useContext } from "react";
import {
  type DiagnosticAction,
  type DiagnosticArea,
  isDiagnosticAction,
  isDiagnosticArea,
} from "../../host/AppDiagnostics";
import { DiagnosticAreaContext, useDiagnostics } from "./DiagnosticsProvider";
import { useOptionalLogActions } from "./LogProvider";

// The same safe activity vocabulary is visible in System Monitor and Sentry.
// Ordinary System Monitor logs remain local and are never breadcrumb input.
export function useDiagnosticBreadcrumb(explicitArea?: DiagnosticArea) {
  const currentArea = useContext(DiagnosticAreaContext);
  const area = explicitArea ?? currentArea;
  const diagnostics = useDiagnostics();
  const log = useOptionalLogActions()?.log;
  return useCallback(
    (action: DiagnosticAction) => {
      if (!isDiagnosticArea(area) || !isDiagnosticAction(action)) return;
      log?.(`Activity: ${area}.${action}`);
      try {
        diagnostics?.addBreadcrumb({ area, action });
      } catch {
        // Reporting must never interrupt the user's action.
      }
    },
    [area, diagnostics, log],
  );
}
