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
  // The window hosting this mini-app, so window-addressed bus messages reach
  // the window they were opened into.
  windowId: string;
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
  windowId,
}: MiniAppRouteSegmentsProviderProps) {
  const value = useMemo<MiniAppRouteSegmentsContextValue>(
    () => ({
      appId,
      canGoBack,
      goBack,
      pathSegments,
      setPathSegments,
      windowId,
    }),
    [appId, canGoBack, goBack, pathSegments, setPathSegments, windowId],
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
