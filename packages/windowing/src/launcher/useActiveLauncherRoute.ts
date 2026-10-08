import { useMemo } from "react";
import {
  findTopWindow,
  useWindowStateData,
  type WindowEntry,
} from "../window/WindowStateProvider";
import { useLauncherNavigationState } from "./LauncherNavigationProvider";
import { isLauncherAppId, type LauncherDefinition } from "./launcherDefinition";
import type { NavigationMode } from "./navigationMode";
import type { LauncherRoute } from "./routePaths";

const EMPTY_ROUTE_SEGMENTS: ReadonlyArray<string> = [];
const EMPTY_LAUNCHER_ROUTE: LauncherRoute<never> = {
  appId: null,
  pathSegments: [],
};

/**
 * The mini-app the launcher is presenting: the routed shell's route, or the
 * foremost visible window of one of the launcher's apps.
 */
export function resolveActiveLauncherRoute<AppId extends string>(
  definition: LauncherDefinition<AppId>,
  mode: NavigationMode,
  route: LauncherRoute,
  windows: ReadonlyArray<WindowEntry>,
): LauncherRoute<AppId> {
  if (mode === "routed") {
    return isLauncherAppId(definition, route.appId)
      ? { appId: route.appId, pathSegments: route.pathSegments }
      : EMPTY_LAUNCHER_ROUTE;
  }

  // Shell chrome follows the foremost visible mini-app; utility windows without
  // an app route do not change which mini-app the launcher is presenting.
  const topWindow = findTopWindow(windows, (candidate) => {
    return !candidate.minimized && isLauncherAppId(definition, candidate.appId);
  });
  return topWindow && isLauncherAppId(definition, topWindow.appId)
    ? {
        appId: topWindow.appId,
        pathSegments: topWindow.pathSegments ?? EMPTY_ROUTE_SEGMENTS,
      }
    : EMPTY_LAUNCHER_ROUTE;
}

/**
 * {@link resolveActiveLauncherRoute} for the launcher in context, typed by the
 * definition the host passes, normally the one it gave the provider.
 */
export function useActiveLauncherRoute<AppId extends string>(
  definition: LauncherDefinition<AppId>,
): LauncherRoute<AppId> {
  const { mode, route } = useLauncherNavigationState();
  const { windows } = useWindowStateData();
  return useMemo(
    () => resolveActiveLauncherRoute(definition, mode, route, windows),
    [definition, mode, route, windows],
  );
}
