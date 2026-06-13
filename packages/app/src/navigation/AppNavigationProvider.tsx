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
import type { AppNavigationMode } from "./AppNavigationMode";
import {
  type AppRouteState,
  buildMiniAppPath,
  parseAppRoute,
} from "./AppRoutePaths";

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
  openMiniApp: (request: OpenMiniAppRequest) => void;
}

interface AppNavigationState {
  mode: AppNavigationMode;
  route: AppRouteState;
}

interface AppNavigationProviderProps extends PropsWithChildren {
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>;
  mode: AppNavigationMode;
}

interface AppNavigationRuntime {
  actions: Pick<WindowStateActions, "bringToFront" | "create" | "restore">;
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

function AppNavigationWindowRuntimeBridge({
  miniApps,
  mode,
  runtimeRef,
}: {
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>;
  mode: AppNavigationMode;
  runtimeRef: MutableRefObject<AppNavigationRuntime>;
}) {
  const { bringToFront, create, restore } = useWindowActions();
  const { windows } = useWindowStateData();

  useEffect(() => {
    runtimeRef.current = {
      actions: { bringToFront, create, restore },
      miniApps,
      mode,
      windows,
    };
  }, [bringToFront, create, miniApps, mode, restore, runtimeRef, windows]);

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

  useEffect(() => {
    if (mode !== "routed" || typeof window === "undefined") {
      return;
    }

    const handlePopState = () => {
      setRoute(readCurrentRoute(runtimeRef.current.miniApps));
    };

    setRoute(readCurrentRoute(runtimeRef.current.miniApps));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [mode]);

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
      const path = buildMiniAppPath(appId, pathSegments);
      setRoute({ appId, pathSegments: [...pathSegments] });

      if (typeof window === "undefined") {
        return;
      }

      const shouldReplace = replace || window.location.pathname === path;
      if (shouldReplace) {
        window.history.replaceState(window.history.state, "", path);
        return;
      }

      window.history.pushState(window.history.state, "", path);
    },
    [],
  );

  return { navigateMiniAppRoute, route };
}

function useAppNavigationActionValue(
  runtimeRef: MutableRefObject<AppNavigationRuntime>,
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
        },
      );
    },
    [navigateMiniAppRoute],
  );
  const getMiniAppHref = useCallback(buildMiniAppPath, []);
  const goBack = useCallback(() => {
    if (typeof window !== "undefined") {
      window.history.back();
    }
  }, []);
  const goForward = useCallback(() => {
    if (typeof window !== "undefined") {
      window.history.forward();
    }
  }, []);

  return useMemo<AppNavigationActions>(
    () => ({
      getMiniAppHref,
      goBack,
      goForward,
      navigateMiniAppRoute,
      openMiniApp,
    }),
    [getMiniAppHref, goBack, goForward, navigateMiniAppRoute, openMiniApp],
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
    },
    miniApps,
    mode,
    windows: [],
  });
  const { navigateMiniAppRoute, route } = useAppRouteController({
    miniApps,
    mode,
    runtimeRef,
  });
  const actions = useAppNavigationActionValue(runtimeRef, navigateMiniAppRoute);
  const state = useMemo<AppNavigationState>(
    () => ({ mode, route }),
    [mode, route],
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

export function useMiniAppRouteSegments(appId: MiniAppId) {
  const actions = useContext(AppNavigationActionsContext);
  const state = useContext(AppNavigationStateContext);
  const isRouted = actions !== null && state?.mode === "routed";
  const pathSegments =
    isRouted && state.route.appId === appId
      ? state.route.pathSegments
      : EMPTY_ROUTE_SEGMENTS;
  const setPathSegments = useCallback(
    (
      nextPathSegments: ReadonlyArray<string>,
      options: { replace?: boolean | undefined } = {},
    ) => {
      actions?.navigateMiniAppRoute({
        appId,
        pathSegments: nextPathSegments,
        ...(options.replace === undefined ? {} : { replace: options.replace }),
      });
    },
    [actions, appId],
  );

  return useMemo(
    () => ({
      isRouted,
      pathSegments,
      setPathSegments,
    }),
    [isRouted, pathSegments, setPathSegments],
  );
}

export { parseAppRoute } from "./AppRoutePaths";
