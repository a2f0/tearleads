import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
} from "react";
import type { MiniAppId } from "../mini-apps/types";

interface MiniAppRouteSegmentsContextValue {
  appId: MiniAppId;
  pathSegments: ReadonlyArray<string>;
  setPathSegments: (
    pathSegments: ReadonlyArray<string>,
    options?: { replace?: boolean | undefined },
  ) => void;
}

interface MiniAppRouteSegmentsProviderProps extends PropsWithChildren {
  appId: MiniAppId;
  pathSegments: ReadonlyArray<string>;
  setPathSegments: (
    pathSegments: ReadonlyArray<string>,
    options?: { replace?: boolean | undefined },
  ) => void;
}

const MiniAppRouteSegmentsContext =
  createContext<MiniAppRouteSegmentsContextValue | null>(null);

export function MiniAppRouteSegmentsProvider({
  appId,
  children,
  pathSegments,
  setPathSegments,
}: MiniAppRouteSegmentsProviderProps) {
  const updatePathSegments = useCallback(
    (
      nextPathSegments: ReadonlyArray<string>,
      options: { replace?: boolean | undefined } = {},
    ) => {
      setPathSegments(nextPathSegments, options);
    },
    [setPathSegments],
  );
  const value = useMemo<MiniAppRouteSegmentsContextValue>(
    () => ({
      appId,
      pathSegments,
      setPathSegments: updatePathSegments,
    }),
    [appId, pathSegments, updatePathSegments],
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
