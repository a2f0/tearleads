import { useMemo } from "react";
import {
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

  const topWindow = windows.reduce<WindowEntry | null>(
    (top, candidate) =>
      !candidate.minimized &&
      candidate.appId &&
      (!top || candidate.zIndex > top.zIndex)
        ? candidate
        : top,
    null,
  );
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
