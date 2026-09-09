import { type PropsWithChildren, useEffect, useRef } from "react";
import type { MiniAppId } from "../../mini-apps/types";
import { useMiniAppRouteSegments } from "../../navigation/AppNavigationProvider";
import {
  DiagnosticAreaContext,
  useDiagnostics,
} from "../../providers/logging/DiagnosticsProvider";
import { useOptionalLogActions } from "../../providers/logging/LogProvider";
import { useDiagnosticBreadcrumb } from "../../providers/logging/useDiagnosticBreadcrumb";
import { AppErrorBoundary } from "../shared/AppErrorBoundary";

export function MiniAppBoundary({
  appId,
  children,
}: PropsWithChildren<{ appId: MiniAppId }>) {
  const diagnostics = useDiagnostics();
  const breadcrumb = useDiagnosticBreadcrumb(appId);
  const logs = useOptionalLogActions();
  const { pathSegments } = useMiniAppRouteSegments(appId);
  // Route values are used only for local change detection. They never leave
  // this component and are never passed to a logger or diagnostics adapter.
  const routeKey = JSON.stringify([appId, pathSegments]);
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previous.current === routeKey) return;
    breadcrumb(previous.current === undefined ? "open" : "navigate");
    previous.current = routeKey;
  }, [breadcrumb, routeKey]);

  return (
    <DiagnosticAreaContext.Provider value={appId}>
      <AppErrorBoundary
        key={appId}
        area={appId}
        resetKey={routeKey}
        diagnostics={diagnostics}
        onError={(error) => {
          // Keep the message in System Monitor, including on native targets.
          // A string cause stays local; the boundary reports the Error once.
          logs?.logError("Mini-app render failed", String(error));
        }}
        onRetry={() => breadcrumb("retry")}
      >
        {children}
      </AppErrorBoundary>
    </DiagnosticAreaContext.Provider>
  );
}
