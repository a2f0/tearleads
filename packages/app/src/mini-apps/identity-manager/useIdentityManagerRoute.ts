import { useCallback, useState } from "react";
import { useMiniAppRouteSegments } from "../../navigation/AppNavigationProvider";
import {
  formatIdentityManagerRouteSegments,
  type IdentityManagerView,
  parseIdentityManagerRouteSegments,
} from "./routes";

export function useIdentityManagerRoute() {
  const { isRouted, pathSegments, setPathSegments } =
    useMiniAppRouteSegments("identity-manager");
  const [localView, setLocalView] = useState<IdentityManagerView>("menu");
  const view = isRouted
    ? parseIdentityManagerRouteSegments(pathSegments)
    : localView;
  const setView = useCallback(
    (nextView: IdentityManagerView) => {
      if (isRouted) {
        setPathSegments(formatIdentityManagerRouteSegments(nextView));
        return;
      }

      setLocalView(nextView);
    },
    [isRouted, setPathSegments],
  );

  return { isRouted, setView, view };
}
