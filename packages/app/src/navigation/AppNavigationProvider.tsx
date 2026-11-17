import {
  type LauncherDefinition,
  type LauncherNavigationActions,
  LauncherNavigationProvider,
  type LauncherNavigationState,
  type LauncherRoute,
  type NavigationMode,
  useLauncherNavigationActions,
  useLauncherNavigationState,
} from "@tearleads/windowing";
import { type PropsWithChildren, useMemo } from "react";
import { isMiniAppId, type MiniAppId } from "../mini-apps/types";

// The windowing launcher's navigation, bound to the app's mini-app ids.

interface AppNavigationProviderProps extends PropsWithChildren {
  defaultWindowEnabled?: boolean | undefined;
  launcher: LauncherDefinition<MiniAppId>;
  mode: NavigationMode;
  // Whether this pane's windowed desktop opens the app the URL names, such as
  // an incoming identity link. Only the active pane does.
  routeWindowEnabled?: boolean | undefined;
}

export function AppNavigationProvider({
  children,
  defaultWindowEnabled,
  launcher,
  mode,
  routeWindowEnabled = true,
}: AppNavigationProviderProps) {
  return (
    <LauncherNavigationProvider
      defaultWindowEnabled={defaultWindowEnabled}
      definition={launcher}
      mode={mode}
      routeWindowEnabled={defaultWindowEnabled !== false && routeWindowEnabled}
    >
      {children}
    </LauncherNavigationProvider>
  );
}

export function useAppNavigationActions(): LauncherNavigationActions<MiniAppId> {
  return useLauncherNavigationActions();
}

interface AppNavigationState extends Omit<LauncherNavigationState, "route"> {
  route: LauncherRoute<MiniAppId>;
}

export function useAppNavigationState(): AppNavigationState {
  const state = useLauncherNavigationState();
  return useMemo(() => {
    const { appId, pathSegments } = state.route;
    return {
      ...state,
      route: isMiniAppId(appId)
        ? { appId, pathSegments }
        : { appId: null, pathSegments },
    };
  }, [state]);
}
