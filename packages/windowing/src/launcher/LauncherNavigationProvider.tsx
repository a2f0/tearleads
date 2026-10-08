import {
  type MutableRefObject,
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRequiredContext } from "../createRequiredContext";
import {
  findTopWindow,
  useWindowActions,
  useWindowStateData,
  type WindowStateActions,
  type WindowStateData,
} from "../window/WindowStateProvider";
import type { LauncherDefinition } from "./launcherDefinition";
import { useMiniAppWindowRouteSegments } from "./MiniAppRouteSegmentsContext";
import {
  DEFAULT_NAVIGATION_HISTORY_CURSOR,
  getNavigationHistoryAvailability,
  type NavigationHistoryAvailability,
  type NavigationHistoryCursor,
  readNavigationHistoryCursor,
} from "./navigationHistory";
import type { NavigationMode } from "./navigationMode";
import {
  replaceWindowHistoryCursor,
  useRoutedPathNavigator,
} from "./routedPathNavigator";
import {
  buildMiniAppPath,
  LAUNCHER_HOME_PATH,
  type LauncherRoute,
  parseLauncherRoute,
} from "./routePaths";

/** Where a new window opens when a request names no position. */
export const DEFAULT_MINI_APP_POSITION = { x: 200, y: 160 };

/** A request to show an app: in a window, or as the routed shell's page. */
export interface OpenMiniAppRequest<AppId extends string = string> {
  appId: AppId;
  pathSegments?: ReadonlyArray<string> | undefined;
  /** Where a new window opens. */
  position?: { x: number; y: number } | undefined;
  /** Raise the app's open window instead of opening another. Defaults to true. */
  reuseExisting?: boolean | undefined;
}

export interface LauncherNavigationActions<AppId extends string = string> {
  getMiniAppHref: (
    appId: AppId,
    pathSegments?: ReadonlyArray<string> | undefined,
  ) => string;
  goBack: () => void;
  goForward: () => void;
  navigateMiniAppRoute: (input: {
    appId: AppId;
    pathSegments?: ReadonlyArray<string> | undefined;
    replace?: boolean | undefined;
  }) => void;
  navigateHome: (input?: { replace?: boolean | undefined }) => void;
  // Returns the window the app opened in or was raised to, or null when the
  // routed shell shows it instead.
  openMiniApp: (request: OpenMiniAppRequest<AppId>) => string | null;
}

export interface LauncherNavigationState<AppId extends string = string> {
  definition: LauncherDefinition<AppId>;
  history: NavigationHistoryAvailability;
  mode: NavigationMode;
  route: LauncherRoute<AppId>;
}

interface LauncherNavigationProviderProps extends PropsWithChildren {
  definition: LauncherDefinition;
  mode: NavigationMode;
}

interface LauncherNavigationRuntime {
  actions: Pick<
    WindowStateActions,
    "bringToFront" | "create" | "restore" | "updateRoute"
  >;
  definition: LauncherDefinition;
  mode: NavigationMode;
  windows: WindowStateData["windows"];
}

const launcherNavigationActionsContext =
  createRequiredContext<LauncherNavigationActions>(
    "useLauncherNavigationActions requires LauncherNavigationProvider.",
  );
const launcherNavigationStateContext =
  createRequiredContext<LauncherNavigationState>(
    "useLauncherNavigationState requires LauncherNavigationProvider.",
  );
const EMPTY_ROUTE_SEGMENTS: ReadonlyArray<string> = [];

function readCurrentRoute(definition: LauncherDefinition): LauncherRoute {
  return parseLauncherRoute(window.location.pathname, definition);
}

function readWindowHistoryCursor(): NavigationHistoryCursor {
  return (
    readNavigationHistoryCursor(window.history.state) ??
    DEFAULT_NAVIGATION_HISTORY_CURSOR
  );
}

function ensureWindowHistoryCursor(): NavigationHistoryCursor {
  const cursor = readWindowHistoryCursor();
  if (readNavigationHistoryCursor(window.history.state) === null) {
    replaceWindowHistoryCursor(cursor);
  }

  return cursor;
}

function LauncherNavigationWindowRuntimeBridge({
  definition,
  mode,
  runtimeRef,
}: {
  definition: LauncherDefinition;
  mode: NavigationMode;
  runtimeRef: MutableRefObject<LauncherNavigationRuntime>;
}) {
  const { bringToFront, create, restore, updateRoute } = useWindowActions();
  const { windows } = useWindowStateData();

  useEffect(() => {
    runtimeRef.current = {
      actions: { bringToFront, create, restore, updateRoute },
      definition,
      mode,
      windows,
    };
  }, [
    bringToFront,
    create,
    definition,
    mode,
    restore,
    runtimeRef,
    updateRoute,
    windows,
  ]);

  return null;
}

function useLauncherRouteController({
  definition,
  mode,
  runtimeRef,
}: {
  definition: LauncherDefinition;
  mode: NavigationMode;
  runtimeRef: MutableRefObject<LauncherNavigationRuntime>;
}) {
  const [route, setRoute] = useState<LauncherRoute>(() =>
    readCurrentRoute(definition),
  );
  const [historyCursor, setHistoryCursorState] =
    useState<NavigationHistoryCursor>(readWindowHistoryCursor);
  const historyCursorRef = useRef(historyCursor);
  const setHistoryCursor = useCallback((cursor: NavigationHistoryCursor) => {
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
    if (mode !== "routed") {
      return;
    }

    const handlePopState = (event: PopStateEvent) => {
      setHistoryCursor(
        readNavigationHistoryCursor(event.state) ??
          DEFAULT_NAVIGATION_HISTORY_CURSOR,
      );
      setRoute(readCurrentRoute(runtimeRef.current.definition));
    };

    setHistoryCursor(ensureWindowHistoryCursor());
    setRoute(readCurrentRoute(runtimeRef.current.definition));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [mode, runtimeRef, setHistoryCursor]);

  const navigateMiniAppRoute = useCallback(
    ({
      appId,
      pathSegments = [],
      replace = false,
    }: {
      appId: string;
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
        path: LAUNCHER_HOME_PATH,
        replace,
        route: { appId: null, pathSegments: [] },
      });
    },
    [navigateRoutedPath],
  );

  const goBack = useCallback(() => {
    if (historyCursorRef.current.index > 0) {
      setHistoryCursor({
        ...historyCursorRef.current,
        index: historyCursorRef.current.index - 1,
      });
      window.history.back();
    }
  }, [setHistoryCursor]);
  const goForward = useCallback(() => {
    const { entries, index } = historyCursorRef.current;
    if (index < entries - 1) {
      setHistoryCursor({
        ...historyCursorRef.current,
        index: index + 1,
      });
      window.history.forward();
    }
  }, [setHistoryCursor]);
  const history = useMemo(
    () => getNavigationHistoryAvailability(historyCursor),
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

function useLauncherNavigationActionValue(
  runtimeRef: MutableRefObject<LauncherNavigationRuntime>,
  goBack: LauncherNavigationActions["goBack"],
  goForward: LauncherNavigationActions["goForward"],
  navigateHome: LauncherNavigationActions["navigateHome"],
  navigateMiniAppRoute: LauncherNavigationActions["navigateMiniAppRoute"],
): LauncherNavigationActions {
  const openMiniApp = useCallback(
    ({
      appId,
      pathSegments,
      position = DEFAULT_MINI_APP_POSITION,
      reuseExisting = true,
    }: OpenMiniAppRequest) => {
      const {
        actions,
        definition,
        mode: currentMode,
        windows: currentWindows,
      } = runtimeRef.current;

      if (currentMode === "routed") {
        navigateMiniAppRoute({ appId, pathSegments });
        return null;
      }

      const existingWindow = reuseExisting
        ? findTopWindow(currentWindows, (windowEntry) => {
            return windowEntry.appId === appId;
          })
        : null;
      if (existingWindow) {
        actions.restore(existingWindow.id);
        actions.bringToFront(existingWindow.id);
        if (pathSegments) {
          actions.updateRoute(existingWindow.id, pathSegments);
        }
        return existingWindow.id;
      }

      const app = definition.apps[appId];
      if (!app) {
        throw new Error(`Unknown mini-app: ${appId}`);
      }
      return actions.create(
        app.title,
        position.x,
        position.y,
        app.createComponent(),
        {
          appId,
          initialShowSidebar: app.initialShowSidebar,
          ...(pathSegments ? { pathSegments } : {}),
        },
      );
    },
    [navigateMiniAppRoute, runtimeRef],
  );
  const getMiniAppHref = useCallback(buildMiniAppPath, []);
  return useMemo<LauncherNavigationActions>(
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

/**
 * Navigation for a launcher's mini-apps, in either mode. In `windowed` mode,
 * opening an app opens or raises its window (inside a
 * {@link WindowStateProvider}); in `routed` mode it navigates the browser to
 * the app's route, `/app/<app id>/…`, which the routed shell shows.
 */
export function LauncherNavigationProvider({
  children,
  definition,
  mode,
}: LauncherNavigationProviderProps) {
  const runtimeRef = useRef<LauncherNavigationRuntime>({
    actions: {
      bringToFront: () => {},
      create: () => "",
      restore: () => {},
      updateRoute: () => {},
    },
    definition,
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
  } = useLauncherRouteController({
    definition,
    mode,
    runtimeRef,
  });
  const actions = useLauncherNavigationActionValue(
    runtimeRef,
    goBack,
    goForward,
    navigateHome,
    navigateMiniAppRoute,
  );
  const state = useMemo<LauncherNavigationState>(
    () => ({ definition, history, mode, route }),
    [definition, history, mode, route],
  );

  return (
    <launcherNavigationActionsContext.context.Provider value={actions}>
      <launcherNavigationStateContext.context.Provider value={state}>
        <LauncherNavigationWindowRuntimeBridge
          definition={definition}
          mode={mode}
          runtimeRef={runtimeRef}
        />
        {children}
      </launcherNavigationStateContext.context.Provider>
    </launcherNavigationActionsContext.context.Provider>
  );
}

// The context names apps by their string ids. The actions accept a host's own
// narrower id type as they are; a host narrows the route's id with
// isLauncherAppId (or its own guard) to read it back as that type.
export const useLauncherNavigationActions =
  launcherNavigationActionsContext.useRequired;

export const useLauncherNavigationState =
  launcherNavigationStateContext.useRequired;

export const useOptionalLauncherNavigationState =
  launcherNavigationStateContext.useOptional;

/**
 * The route of `appId` where it is hosted: the browser route in the routed
 * shell, or its window's own route and Back stack in a window. Mini-apps read
 * this rather than branching on navigation mode.
 */
export function useMiniAppRouteSegments(appId: string) {
  const actions = launcherNavigationActionsContext.useOptional();
  const state = launcherNavigationStateContext.useOptional();
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
  // yield to a real Back affordance asks one question and gets the right answer
  // in both shells.
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
