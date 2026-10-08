import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";
import {
  createNavigationHistoryState,
  getNextNavigationHistoryCursor,
  type NavigationHistoryCursor,
} from "./navigationHistory";
import type { NavigationMode } from "./navigationMode";
import type { LauncherRoute } from "./routePaths";

interface RoutedNavigationRuntime {
  mode: NavigationMode;
}

interface RoutedPathNavigatorInput {
  path: string;
  replace?: boolean | undefined;
  route: LauncherRoute;
}

function pushWindowHistoryCursor(
  cursor: NavigationHistoryCursor,
  path: string,
) {
  const state = createNavigationHistoryState(window.history.state, cursor);
  window.history.pushState(state, "", path);
}

export function replaceWindowHistoryCursor(
  cursor: NavigationHistoryCursor,
  path?: string,
) {
  const state = createNavigationHistoryState(window.history.state, cursor);
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
  historyCursorRef: MutableRefObject<NavigationHistoryCursor>;
  runtimeRef: MutableRefObject<RoutedNavigationRuntime>;
  setHistoryCursor: (cursor: NavigationHistoryCursor) => void;
  setRoute: Dispatch<SetStateAction<LauncherRoute>>;
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
      const nextCursor = getNextNavigationHistoryCursor(currentCursor);
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
