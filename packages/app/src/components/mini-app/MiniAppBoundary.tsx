import { type PropsWithChildren, useEffect, useRef } from "react";
import type { MiniAppId } from "../../mini-apps/types";
import { useMiniAppRouteSegments } from "../../navigation/AppNavigationProvider";
import {
  DiagnosticAreaContext,
  useDiagnostics,
} from "../../providers/logging/DiagnosticsProvider";
import { useDiagnosticBreadcrumb } from "../../providers/logging/useDiagnosticBreadcrumb";
import { AppErrorBoundary } from "../shared/AppErrorBoundary";

export function MiniAppBoundary({
  appId,
  children,
}: PropsWithChildren<{ appId: MiniAppId }>) {
  const diagnostics = useDiagnostics();
  const breadcrumb = useDiagnosticBreadcrumb(appId);
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
        diagnostics={diagnostics}
        onRetry={() => breadcrumb("retry")}
      >
        {children}
      </AppErrorBoundary>
    </DiagnosticAreaContext.Provider>
  );
}
