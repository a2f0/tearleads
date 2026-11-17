import { useEffect, useRef } from "react";
import { isLauncherAppId, type LauncherDefinition } from "./launcherDefinition";
import type { NavigationMode } from "./navigationMode";
import type { OpenMiniAppRequest } from "./openMiniAppWindow";
import { parseLauncherRoute } from "./routePaths";

/** The request that opens the app the browser's URL names, if it names one. */
function readRouteWindowRequest(
  definition: LauncherDefinition,
): OpenMiniAppRequest | null {
  const { appId, pathSegments } = parseLauncherRoute(
    window.location.pathname,
    definition,
  );
  if (appId === null) return null;
  // An app's root route names no place within it, so the app's open window
  // is raised where it is.
  return pathSegments.length > 0 ? { appId, pathSegments } : { appId };
}

/**
 * The requests that open the host's default windows, each app once and
 * without the URL's app, which opens after them: the launcher's open requests
 * within one pass cannot see the windows the earlier ones created.
 */
function readDefaultWindowRequests(
  definition: LauncherDefinition,
  routeRequest: OpenMiniAppRequest | null,
): OpenMiniAppRequest[] {
  return [...new Set(definition.defaultWindowAppIds)]
    .filter(
      (appId) =>
        appId !== routeRequest?.appId && isLauncherAppId(definition, appId),
    )
    .map((appId) => ({ appId }));
}

/**
 * Opens the windows a windowed desktop starts with, once per entry into
 * windowed mode: the host's default windows, in order, if the desktop is
 * empty, and then the app the browser's URL names, in front. While windowed,
 * a browser history step to another app's URL opens that app too.
 */
export function useWindowedEntryWindows({
  defaultWindowEnabled,
  definition,
  mode,
  openMiniApp,
  routeWindowEnabled,
  windowCount,
}: {
  defaultWindowEnabled: boolean;
  definition: LauncherDefinition;
  mode: NavigationMode;
  openMiniApp: (request: OpenMiniAppRequest) => string | null;
  routeWindowEnabled: boolean;
  windowCount: number;
}) {
  const handledDefaultWindows = useRef(false);
  const handledRouteWindow = useRef(false);

  useEffect(() => {
    if (mode !== "windowed") {
      handledDefaultWindows.current = false;
      handledRouteWindow.current = false;
      return;
    }
    // The URL belongs to the entry, not to this launcher: one that is
    // disabled at the entry skips it rather than opening it when enabled.
    const routeRequest =
      routeWindowEnabled && !handledRouteWindow.current
        ? readRouteWindowRequest(definition)
        : null;
    // Record the entry before opening, including across StrictMode effects.
    handledRouteWindow.current = true;
    const requests: OpenMiniAppRequest[] = [];
    if (defaultWindowEnabled && !handledDefaultWindows.current) {
      handledDefaultWindows.current = true;
      if (windowCount === 0) {
        requests.push(...readDefaultWindowRequests(definition, routeRequest));
      }
    }
    if (routeRequest) requests.push(routeRequest);
    for (const request of requests) openMiniApp(request);
  }, [
    defaultWindowEnabled,
    definition,
    mode,
    openMiniApp,
    routeWindowEnabled,
    windowCount,
  ]);

  useEffect(() => {
    if (mode !== "windowed" || !routeWindowEnabled) return;
    const openRouteWindow = () => {
      const routeRequest = readRouteWindowRequest(definition);
      if (routeRequest) openMiniApp(routeRequest);
    };
    window.addEventListener("popstate", openRouteWindow);
    return () => window.removeEventListener("popstate", openRouteWindow);
  }, [definition, mode, openMiniApp, routeWindowEnabled]);
}
