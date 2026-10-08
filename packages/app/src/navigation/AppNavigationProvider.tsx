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
  launcher: LauncherDefinition<MiniAppId>;
  mode: NavigationMode;
}

export function AppNavigationProvider({
  children,
  launcher,
  mode,
}: AppNavigationProviderProps) {
  return (
    <LauncherNavigationProvider definition={launcher} mode={mode}>
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
