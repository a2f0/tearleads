import { useState } from "react";
import { useMiniAppRouteState } from "../../navigation/useMiniAppRouteState";
import {
  formatIdentityManagerRouteSegments,
  type IdentityManagerView,
  parseIdentityManagerRouteSegments,
} from "./routes";

export function useIdentityManagerRoute() {
  const [localView, setLocalView] = useState<IdentityManagerView>("menu");
  const {
    isRouted,
    route: view,
    setRoute: setView,
  } = useMiniAppRouteState({
    appId: "identity-manager",
    formatRouteSegments: formatIdentityManagerRouteSegments,
    localRoute: localView,
    parseRouteSegments: parseIdentityManagerRouteSegments,
    setLocalRoute: setLocalView,
  });

  return { isRouted, setView, view };
}
