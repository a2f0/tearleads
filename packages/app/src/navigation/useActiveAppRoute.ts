import { useMemo } from "react";
import {
  findTopWindow,
  useWindowStateData,
  type WindowEntry,
} from "../components/window/WindowStateProvider";
import type { AppNavigationMode } from "./AppNavigationMode";
import { useAppNavigationState } from "./AppNavigationProvider";
import type { AppRouteState } from "./AppRoutePaths";

const EMPTY_ROUTE_SEGMENTS: ReadonlyArray<string> = [];
const EMPTY_APP_ROUTE: AppRouteState = { appId: null, pathSegments: [] };

export function resolveActiveAppRoute(
  mode: AppNavigationMode,
  route: AppRouteState,
  windows: ReadonlyArray<WindowEntry>,
): AppRouteState {
  if (mode === "routed") {
    return route;
  }

  // Shell chrome follows the foremost visible mini-app; utility windows without
  // an app route do not change which mini-app the pane is presenting.
  const topWindow = findTopWindow(windows, (candidate) => {
    return !candidate.minimized && candidate.appId !== undefined;
  });
  return topWindow?.appId
    ? {
        appId: topWindow.appId,
        pathSegments: topWindow.miniAppPathSegments ?? EMPTY_ROUTE_SEGMENTS,
      }
    : EMPTY_APP_ROUTE;
}

export function useActiveAppRoute(): AppRouteState {
  const { mode, route } = useAppNavigationState();
  const { windows } = useWindowStateData();
  return useMemo(
    () => resolveActiveAppRoute(mode, route, windows),
    [mode, route, windows],
  );
}
