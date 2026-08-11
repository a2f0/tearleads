import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";
import {
  type AppNavigationHistoryCursor,
  createAppNavigationHistoryState,
  getNextAppNavigationHistoryCursor,
} from "./AppNavigationHistory";
import type { AppNavigationMode } from "./AppNavigationMode";
import type { AppRouteState } from "./AppRoutePaths";

interface RoutedNavigationRuntime {
  mode: AppNavigationMode;
}

interface RoutedPathNavigatorInput {
  path: string;
  replace?: boolean | undefined;
  route: AppRouteState;
}

function pushWindowHistoryCursor(
  cursor: AppNavigationHistoryCursor,
  path: string,
) {
  const state = createAppNavigationHistoryState(window.history.state, cursor);
  window.history.pushState(state, "", path);
}

export function replaceWindowHistoryCursor(
  cursor: AppNavigationHistoryCursor,
  path?: string,
) {
  const state = createAppNavigationHistoryState(window.history.state, cursor);
  if (path === undefined) {
    window.history.replaceState(state, "");
    return;
  }

  window.history.replaceState(state, "", path);
}

export function useRoutedPathNavigator({
  historyCursorRef,
  runtimeRef,
  setHistoryCursor,
  setRoute,
}: {
  historyCursorRef: MutableRefObject<AppNavigationHistoryCursor>;
  runtimeRef: MutableRefObject<RoutedNavigationRuntime>;
  setHistoryCursor: (cursor: AppNavigationHistoryCursor) => void;
  setRoute: Dispatch<SetStateAction<AppRouteState>>;
}) {
  return useCallback(
    ({ path, replace = false, route }: RoutedPathNavigatorInput) => {
      if (runtimeRef.current.mode !== "routed") {
        return;
      }

      setRoute(route);
      const shouldReplace = replace || window.location.pathname === path;
      if (shouldReplace) {
        replaceWindowHistoryCursor(historyCursorRef.current, path);
        return;
      }

      const currentCursor = historyCursorRef.current;
      const nextCursor = getNextAppNavigationHistoryCursor(currentCursor);
      replaceWindowHistoryCursor({
        entries: nextCursor.entries,
        index: currentCursor.index,
      });
      setHistoryCursor(nextCursor);
      pushWindowHistoryCursor(nextCursor, path);
    },
    [historyCursorRef, runtimeRef, setHistoryCursor, setRoute],
  );
}
