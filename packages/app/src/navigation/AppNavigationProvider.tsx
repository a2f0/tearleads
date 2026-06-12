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

const APP_ROUTE_PREFIX = "/app/";

interface AppRouteState {
  appId: MiniAppId | null;
}

interface AppNavigationActions {
  getMiniAppHref: (appId: MiniAppId) => string;
  goBack: () => void;
  goForward: () => void;
  openMiniApp: (request: OpenMiniAppRequest) => void;
}

interface AppNavigationState {
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

function buildMiniAppPath(appId: MiniAppId): string {
  return `${APP_ROUTE_PREFIX}${encodeURIComponent(appId)}`;
}

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

export function parseAppRoute(
  pathname: string,
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>,
): AppRouteState {
  if (!pathname.startsWith(APP_ROUTE_PREFIX)) {
    return { appId: null };
  }

  const [encodedAppId = ""] = pathname
    .slice(APP_ROUTE_PREFIX.length)
    .split("/");
  const rawAppId = decodeURIComponent(encodedAppId);
  return isKnownMiniAppId(rawAppId, miniApps)
    ? { appId: rawAppId }
    : { appId: null };
}

function isKnownMiniAppId(
  appId: string,
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>,
): appId is MiniAppId {
  return Object.hasOwn(miniApps, appId);
}

function readCurrentRoute(
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>,
): AppRouteState {
  if (typeof window === "undefined") {
    return { appId: null };
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

  const pushMiniAppRoute = useCallback((appId: MiniAppId) => {
    const path = buildMiniAppPath(appId);
    setRoute({ appId });

    if (typeof window === "undefined") {
      return;
    }

    if (window.location.pathname === path) {
      window.history.replaceState(window.history.state, "", path);
      return;
    }

    window.history.pushState(window.history.state, "", path);
  }, []);

  return { pushMiniAppRoute, route };
}

function useAppNavigationActionValue(
  runtimeRef: MutableRefObject<AppNavigationRuntime>,
  pushMiniAppRoute: (appId: MiniAppId) => void,
): AppNavigationActions {
  const openMiniApp = useCallback(
    ({
      appId,
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
        pushMiniAppRoute(appId);
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
    [pushMiniAppRoute],
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
      openMiniApp,
    }),
    [getMiniAppHref, goBack, goForward, openMiniApp],
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
  const { pushMiniAppRoute, route } = useAppRouteController({
    miniApps,
    mode,
    runtimeRef,
  });
  const actions = useAppNavigationActionValue(runtimeRef, pushMiniAppRoute);
  const state = useMemo<AppNavigationState>(() => ({ route }), [route]);

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
