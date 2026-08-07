import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import type { MiniAppId } from "../mini-apps/types";

interface MiniAppRouteSegmentsContextValue {
  appId: MiniAppId;
  canGoBack: boolean;
  goBack: () => void;
  pathSegments: ReadonlyArray<string>;
  setPathSegments: (
    pathSegments: ReadonlyArray<string>,
    options?: { replace?: boolean | undefined },
  ) => void;
}

type MiniAppRouteSegmentsProviderProps =
  PropsWithChildren<MiniAppRouteSegmentsContextValue>;

const MiniAppRouteSegmentsContext =
  createContext<MiniAppRouteSegmentsContextValue | null>(null);

export function MiniAppRouteSegmentsProvider({
  appId,
  canGoBack,
  children,
  goBack,
  pathSegments,
  setPathSegments,
}: MiniAppRouteSegmentsProviderProps) {
  const value = useMemo<MiniAppRouteSegmentsContextValue>(
    () => ({
      appId,
      canGoBack,
      goBack,
      pathSegments,
      setPathSegments,
    }),
    [appId, canGoBack, goBack, pathSegments, setPathSegments],
  );

  return (
    <MiniAppRouteSegmentsContext.Provider value={value}>
      {children}
    </MiniAppRouteSegmentsContext.Provider>
  );
}

export function useMiniAppWindowRouteSegments(appId: MiniAppId) {
  const context = useContext(MiniAppRouteSegmentsContext);
  if (!context || context.appId !== appId) {
    return null;
  }

  return context;
}
