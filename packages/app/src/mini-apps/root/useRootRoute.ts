import { useState } from "react";
import { useMiniAppRouteState } from "../../navigation/useMiniAppRouteState";
import {
  formatRootRouteSegments,
  MENU_ROOT_ROUTE,
  parseRootRouteSegments,
  type RootRoute,
} from "./routes";

export function useRootRoute() {
  const [localRoute, setLocalRoute] = useState<RootRoute>(MENU_ROOT_ROUTE);
  return useMiniAppRouteState({
    appId: "root",
    formatRouteSegments: formatRootRouteSegments,
    localRoute,
    parseRouteSegments: parseRootRouteSegments,
    setLocalRoute,
  });
}
