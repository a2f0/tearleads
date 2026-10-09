import { useCallback } from "react";
import { useMiniAppRouteSegments } from "./LauncherNavigationProvider";

export interface MiniAppRouteSetOptions {
  replace?: boolean | undefined;
}

export function useMiniAppRouteState<
  TRoute,
  TNextRoute extends TRoute = TRoute,
>({
  appId,
  formatRouteSegments,
  localRoute,
  parseRouteSegments,
  setLocalRoute,
}: {
  appId: string;
  formatRouteSegments: (route: TNextRoute) => ReadonlyArray<string>;
  localRoute: TRoute;
  parseRouteSegments: (segments: ReadonlyArray<string>) => TRoute;
  setLocalRoute?: ((route: TNextRoute) => void) | undefined;
}) {
  const { isRouted, pathSegments, setPathSegments } =
    useMiniAppRouteSegments(appId);
  const route = isRouted ? parseRouteSegments(pathSegments) : localRoute;
  const setRoute = useCallback(
    (nextRoute: TNextRoute, options: MiniAppRouteSetOptions = {}) => {
      if (isRouted) {
        setPathSegments(formatRouteSegments(nextRoute), options);
        return;
      }

      setLocalRoute?.(nextRoute);
    },
    [formatRouteSegments, isRouted, setLocalRoute, setPathSegments],
  );

  return { isRouted, route, setRoute };
}
