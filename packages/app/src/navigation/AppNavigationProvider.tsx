import {
  createContext,
  type MutableRefObject,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useWindowActions,
  useWindowStateData,
  type WindowStateActions,
  type WindowStateData,
} from "../components/window/WindowStateProvider";
import {
  DEFAULT_MINI_APP_POSITION,
  type MiniAppDefinition,
  type MiniAppId,
  type OpenMiniAppRequest,
} from "../mini-apps/types";
import {
  type AppNavigationHistoryAvailability,
  type AppNavigationHistoryCursor,
  DEFAULT_APP_NAVIGATION_HISTORY_CURSOR,
  getAppNavigationHistoryAvailability,
  readAppNavigationHistoryCursor,
} from "./AppNavigationHistory";
import type { AppNavigationMode } from "./AppNavigationMode";
import {
  replaceWindowHistoryCursor,
  useRoutedPathNavigator,
} from "./AppRoutedPathNavigator";
import {
  APP_HOME_PATH,
  type AppRouteState,
  buildMiniAppPath,
  parseAppRoute,
} from "./AppRoutePaths";
import { useMiniAppWindowRouteSegments } from "./MiniAppRouteSegmentsContext";

interface AppNavigationActions {
  getMiniAppHref: (
    appId: MiniAppId,
    pathSegments?: ReadonlyArray<string> | undefined,
  ) => string;
  goBack: () => void;
  goForward: () => void;
  navigateMiniAppRoute: (input: {
    appId: MiniAppId;
    pathSegments?: ReadonlyArray<string> | undefined;
    replace?: boolean | undefined;
  }) => void;
  navigateHome: (input?: { replace?: boolean | undefined }) => void;
  openMiniApp: (request: OpenMiniAppRequest) => void;
}

interface AppNavigationState {
  history: AppNavigationHistoryAvailability;
  mode: AppNavigationMode;
  route: AppRouteState;
}

interface AppNavigationProviderProps extends PropsWithChildren {
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>;
  mode: AppNavigationMode;
}

interface AppNavigationRuntime {
  actions: Pick<
    WindowStateActions,
    "bringToFront" | "create" | "restore" | "updateMiniAppRoute"
  >;
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>;
  mode: AppNavigationMode;
  windows: WindowStateData["windows"];
}

const AppNavigationActionsContext = createContext<AppNavigationActions | null>(
  null,
);
const AppNavigationStateContext = createContext<AppNavigationState | null>(
  null,
);
const EMPTY_ROUTE_SEGMENTS: ReadonlyArray<string> = [];

function findTopMiniAppWindow(
  windows: ReturnType<typeof useWindowStateData>["windows"],
  appId: MiniAppId,
) {
  return windows.reduce<(typeof windows)[number] | null>(
    (topWindow, windowEntry) => {
      if (windowEntry.appId !== appId) {
        return topWindow;
      }

      return !topWindow || windowEntry.zIndex > topWindow.zIndex
        ? windowEntry
        : topWindow;
    },
    null,
  );
}

function readCurrentRoute(
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>,
): AppRouteState {
  if (typeof window === "undefined") {
    return { appId: null, pathSegments: [] };
  }

  return parseAppRoute(window.location.pathname, miniApps);
}

function readWindowHistoryCursor(): AppNavigationHistoryCursor {
  if (typeof window === "undefined") {
    return DEFAULT_APP_NAVIGATION_HISTORY_CURSOR;
  }

  return (
    readAppNavigationHistoryCursor(window.history.state) ??
    DEFAULT_APP_NAVIGATION_HISTORY_CURSOR
  );
}

function ensureWindowHistoryCursor(): AppNavigationHistoryCursor {
  const cursor = readWindowHistoryCursor();
  if (
    typeof window !== "undefined" &&
    readAppNavigationHistoryCursor(window.history.state) === null
  ) {
    replaceWindowHistoryCursor(cursor);
  }

  return cursor;
}

function AppNavigationWindowRuntimeBridge({
  miniApps,
  mode,
  runtimeRef,
}: {
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>;
  mode: AppNavigationMode;
  runtimeRef: MutableRefObject<AppNavigationRuntime>;
}) {
  const { bringToFront, create, restore, updateMiniAppRoute } =
    useWindowActions();
  const { windows } = useWindowStateData();

  useEffect(() => {
    runtimeRef.current = {
      actions: { bringToFront, create, restore, updateMiniAppRoute },
      miniApps,
      mode,
      windows,
    };
  }, [
    bringToFront,
    create,
    miniApps,
    mode,
    restore,
    runtimeRef,
    updateMiniAppRoute,
    windows,
  ]);

  return null;
}

function useAppRouteController({
  miniApps,
  mode,
  runtimeRef,
}: {
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>;
  mode: AppNavigationMode;
  runtimeRef: MutableRefObject<AppNavigationRuntime>;
}) {
  const [route, setRoute] = useState<AppRouteState>(() =>
    readCurrentRoute(miniApps),
  );
  const [historyCursor, setHistoryCursorState] =
    useState<AppNavigationHistoryCursor>(readWindowHistoryCursor);
  const historyCursorRef = useRef(historyCursor);
  const setHistoryCursor = useCallback((cursor: AppNavigationHistoryCursor) => {
    historyCursorRef.current = cursor;
    setHistoryCursorState(cursor);
  }, []);
  const navigateRoutedPath = useRoutedPathNavigator({
    historyCursorRef,
    runtimeRef,
    setHistoryCursor,
    setRoute,
  });

  useEffect(() => {
    if (mode !== "routed" || typeof window === "undefined") {
      return;
    }

    const handlePopState = (event: PopStateEvent) => {
      setHistoryCursor(
        readAppNavigationHistoryCursor(event.state) ??
          DEFAULT_APP_NAVIGATION_HISTORY_CURSOR,
      );
      setRoute(readCurrentRoute(runtimeRef.current.miniApps));
    };

    setHistoryCursor(ensureWindowHistoryCursor());
    setRoute(readCurrentRoute(runtimeRef.current.miniApps));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [mode, runtimeRef, setHistoryCursor]);

  const navigateMiniAppRoute = useCallback(
    ({
      appId,
      pathSegments = [],
      replace = false,
    }: {
      appId: MiniAppId;
      pathSegments?: ReadonlyArray<string> | undefined;
      replace?: boolean | undefined;
    }) => {
      navigateRoutedPath({
        path: buildMiniAppPath(appId, pathSegments),
        replace,
        route: { appId, pathSegments: [...pathSegments] },
      });
    },
    [navigateRoutedPath],
  );
  const navigateHome = useCallback(
    ({ replace = false }: { replace?: boolean | undefined } = {}) => {
      navigateRoutedPath({
        path: APP_HOME_PATH,
        replace,
        route: { appId: null, pathSegments: [] },
      });
    },
    [navigateRoutedPath],
  );

  const goBack = useCallback(() => {
    if (typeof window !== "undefined" && historyCursorRef.current.index > 0) {
      setHistoryCursor({
        ...historyCursorRef.current,
        index: historyCursorRef.current.index - 1,
      });
      window.history.back();
    }
  }, [setHistoryCursor]);
  const goForward = useCallback(() => {
    const { entries, index } = historyCursorRef.current;
    if (typeof window !== "undefined" && index < entries - 1) {
      setHistoryCursor({
        ...historyCursorRef.current,
        index: index + 1,
      });
      window.history.forward();
    }
  }, [setHistoryCursor]);
  const history = useMemo(
    () => getAppNavigationHistoryAvailability(historyCursor),
    [historyCursor],
  );

  return {
    goBack,
    goForward,
    history,
    navigateHome,
    navigateMiniAppRoute,
    route,
  };
}

function useAppNavigationActionValue(
  runtimeRef: MutableRefObject<AppNavigationRuntime>,
  goBack: AppNavigationActions["goBack"],
  goForward: AppNavigationActions["goForward"],
  navigateHome: AppNavigationActions["navigateHome"],
  navigateMiniAppRoute: AppNavigationActions["navigateMiniAppRoute"],
): AppNavigationActions {
  const openMiniApp = useCallback(
    ({
      appId,
      pathSegments,
      position = DEFAULT_MINI_APP_POSITION,
      reuseExisting = true,
    }: OpenMiniAppRequest) => {
      const {
        actions,
        miniApps: currentMiniApps,
        mode: currentMode,
        windows: currentWindows,
      } = runtimeRef.current;

      if (currentMode === "routed") {
        navigateMiniAppRoute({ appId, pathSegments });
        return;
      }

      const existingWindow = reuseExisting
        ? findTopMiniAppWindow(currentWindows, appId)
        : null;
      if (existingWindow) {
        actions.restore(existingWindow.id);
        actions.bringToFront(existingWindow.id);
        if (pathSegments) {
          actions.updateMiniAppRoute(existingWindow.id, pathSegments);
        }
        return;
      }

      const definition = currentMiniApps[appId];
      actions.create(
        definition.title,
        position.x,
        position.y,
        definition.createComponent(),
        {
          appId,
          initialShowSidebar: definition.initialShowSidebar,
          ...(pathSegments ? { miniAppPathSegments: pathSegments } : {}),
        },
      );
    },
    [navigateMiniAppRoute],
  );
  const getMiniAppHref = useCallback(buildMiniAppPath, []);
  return useMemo<AppNavigationActions>(
    () => ({
      getMiniAppHref,
      goBack,
      goForward,
      navigateHome,
      navigateMiniAppRoute,
      openMiniApp,
    }),
    [
      getMiniAppHref,
      goBack,
      goForward,
      navigateHome,
      navigateMiniAppRoute,
      openMiniApp,
    ],
  );
}

export function AppNavigationProvider({
  children,
  miniApps,
  mode,
}: AppNavigationProviderProps) {
  const runtimeRef = useRef<AppNavigationRuntime>({
    actions: {
      bringToFront: () => {},
      create: () => "",
      restore: () => {},
      updateMiniAppRoute: () => {},
    },
    miniApps,
    mode,
    windows: [],
  });
  const {
    goBack,
    goForward,
    history,
    navigateHome,
    navigateMiniAppRoute,
    route,
  } = useAppRouteController({
    miniApps,
    mode,
    runtimeRef,
  });
  const actions = useAppNavigationActionValue(
    runtimeRef,
    goBack,
    goForward,
    navigateHome,
    navigateMiniAppRoute,
  );
  const state = useMemo<AppNavigationState>(
    () => ({ history, mode, route }),
    [history, mode, route],
  );

  return (
    <AppNavigationActionsContext.Provider value={actions}>
      <AppNavigationStateContext.Provider value={state}>
        <AppNavigationWindowRuntimeBridge
          miniApps={miniApps}
          mode={mode}
          runtimeRef={runtimeRef}
        />
        {children}
      </AppNavigationStateContext.Provider>
    </AppNavigationActionsContext.Provider>
  );
}

export function useAppNavigationActions(): AppNavigationActions {
  const context = useContext(AppNavigationActionsContext);
  if (!context) {
    throw new Error("useAppNavigationActions requires AppNavigationProvider.");
  }

  return context;
}

export function useAppNavigationState(): AppNavigationState {
  const context = useContext(AppNavigationStateContext);
  if (!context) {
    throw new Error("useAppNavigationState requires AppNavigationProvider.");
  }

  return context;
}

export function useOptionalAppNavigationState(): AppNavigationState | null {
  return useContext(AppNavigationStateContext);
}

export function useMiniAppRouteSegments(appId: MiniAppId) {
  const actions = useContext(AppNavigationActionsContext);
  const state = useContext(AppNavigationStateContext);
  const windowRoute = useMiniAppWindowRouteSegments(appId);
  const isGlobalRouted = actions !== null && state?.mode === "routed";
  const isRouted = isGlobalRouted || windowRoute !== null;
  const pathSegments =
    isGlobalRouted && state.route.appId === appId
      ? state.route.pathSegments
      : (windowRoute?.pathSegments ?? EMPTY_ROUTE_SEGMENTS);
  const windowSetPathSegments = windowRoute?.setPathSegments;
  const setPathSegments = useCallback(
    (
      nextPathSegments: ReadonlyArray<string>,
      options: { replace?: boolean | undefined } = {},
    ) => {
      if (isGlobalRouted) {
        actions?.navigateMiniAppRoute({
          appId,
          pathSegments: nextPathSegments,
          ...(options.replace === undefined
            ? {}
            : { replace: options.replace }),
        });
        return;
      }

      windowSetPathSegments?.(nextPathSegments, options);
    },
    [actions, appId, isGlobalRouted, windowSetPathSegments],
  );
  // "Can this mini-app step back where it is hosted?" — browser history in the
  // routed shell, the window's own Back stack in a window. Mini-apps read this
  // rather than branching on navigation mode, so a detail surface that must
  // yield to a real Back affordance (see explorerChromeOwnsDetailBack) asks one
  // question and gets the right answer in both shells.
  const windowGoBack = windowRoute?.goBack;
  const canGoBack = isGlobalRouted
    ? state.history.canGoBack
    : (windowRoute?.canGoBack ?? false);
  const goBack = useCallback(() => {
    if (isGlobalRouted) {
      actions?.goBack();
      return;
    }

    windowGoBack?.();
  }, [actions, isGlobalRouted, windowGoBack]);

  return useMemo(
    () => ({
      canGoBack,
      goBack,
      isRouted,
      pathSegments,
      setPathSegments,
    }),
    [canGoBack, goBack, isRouted, pathSegments, setPathSegments],
  );
}

export { parseAppRoute } from "./AppRoutePaths";
