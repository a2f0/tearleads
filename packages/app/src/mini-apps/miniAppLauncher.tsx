import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppRouteState } from "../navigation/AppRoutePaths";
import type { OpenMiniAppRequest } from "./types";

type LaunchMiniApp = (request: OpenMiniAppRequest) => void;

interface MiniAppLauncherContextValue {
  activeRoute: AppRouteState | null;
  launch: LaunchMiniApp;
  publishActiveRoute: (launch: LaunchMiniApp, route: AppRouteState) => void;
  registerLauncher: (launch: LaunchMiniApp) => () => void;
}

const MiniAppLauncherContext =
  createContext<MiniAppLauncherContextValue | null>(null);

const NOOP_LAUNCH: LaunchMiniApp = () => {};

/**
 * A shell-to-pane navigation bridge. App-shell chrome (e.g. the billing banner)
 * mounts above the panes, outside their pane-scoped navigation/bus providers, so
 * it cannot call `openMiniApp` itself. The active pane publishes its launcher
 * and effective route here via {@link useRegisterMiniAppLauncher}; shell chrome
 * opens a mini-app in that pane through {@link useMiniAppLauncher}. Because it
 * delegates to the pane's real `openMiniApp`, it works in both the windowed and
 * routed layouts — unlike a deep-link anchor, which only the routed shell honors.
 *
 * This module is deliberately bus-agnostic: the pane supplies its launcher, so
 * the bridge itself is unit-testable without the navigation/bus stack.
 */
export function MiniAppLauncherProvider({ children }: PropsWithChildren) {
  const launcherRef = useRef<LaunchMiniApp | null>(null);
  const [activeRoute, setActiveRoute] = useState<AppRouteState | null>(null);
  const launch = useCallback<LaunchMiniApp>((request) => {
    launcherRef.current?.(request);
  }, []);
  const registerLauncher = useCallback((next: LaunchMiniApp) => {
    launcherRef.current = next;
    return () => {
      // Clear only while still the active launcher, so a newly-active pane that
      // registered before the previous pane's effect cleanup ran is preserved.
      if (launcherRef.current === next) {
        launcherRef.current = null;
        setActiveRoute(null);
      }
    };
  }, []);
  const publishActiveRoute = useCallback(
    (publisher: LaunchMiniApp, route: AppRouteState) => {
      if (launcherRef.current !== publisher) {
        return;
      }
      setActiveRoute((current) =>
        current?.appId === route.appId &&
        current.pathSegments.length === route.pathSegments.length &&
        current.pathSegments.every(
          (segment, index) => segment === route.pathSegments[index],
        )
          ? current
          : route,
      );
    },
    [],
  );
  const value = useMemo(
    () => ({ activeRoute, launch, publishActiveRoute, registerLauncher }),
    [activeRoute, launch, publishActiveRoute, registerLauncher],
  );
  return (
    <MiniAppLauncherContext.Provider value={value}>
      {children}
    </MiniAppLauncherContext.Provider>
  );
}

/** The launch action for app-shell chrome; a no-op when no provider is mounted. */
export function useMiniAppLauncher(): LaunchMiniApp {
  return useContext(MiniAppLauncherContext)?.launch ?? NOOP_LAUNCH;
}

/** The active pane's effective mini-app route, or null before it registers. */
export function useActiveMiniAppRoute(): AppRouteState | null {
  return useContext(MiniAppLauncherContext)?.activeRoute ?? null;
}

/**
 * Publishes `launch` as the shell launcher while `active`, so app-shell chrome
 * opens mini-apps in the calling (visible) pane. A no-op without a provider.
 */
export function useRegisterMiniAppLauncher(
  launch: LaunchMiniApp,
  active: boolean,
  route: AppRouteState,
): void {
  const register = useContext(MiniAppLauncherContext)?.registerLauncher;
  const publishActiveRoute = useContext(
    MiniAppLauncherContext,
  )?.publishActiveRoute;
  useLayoutEffect(() => {
    if (!active || !register) {
      return;
    }
    return register(launch);
  }, [active, launch, register]);
  useLayoutEffect(() => {
    if (active && publishActiveRoute) {
      publishActiveRoute(launch, route);
    }
  }, [active, launch, publishActiveRoute, route]);
}
