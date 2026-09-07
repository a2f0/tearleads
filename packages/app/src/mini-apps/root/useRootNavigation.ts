import { useCallback } from "react";
import type { MiniAppRouteSetOptions } from "../../navigation/useMiniAppRouteState";
import {
  IDENTITIES_ROOT_ROUTE,
  ORGANIZATIONS_ROOT_ROUTE,
  type RootRoute,
  type RootView,
  rootRouteForView,
} from "./routes";

export function useRootNavigation(
  route: RootRoute,
  setRoute: (route: RootRoute, options?: MiniAppRouteSetOptions) => void,
) {
  const setView = useCallback(
    (view: RootView) => setRoute(rootRouteForView(view)),
    [setRoute],
  );
  const openIdentity = useCallback(
    (userId: string) =>
      setRoute({
        userId,
        view: "identities",
        ...(route.view === "organizations" && route.organizationId
          ? { returnOrganizationId: route.organizationId }
          : {}),
      }),
    [route, setRoute],
  );
  // Leaving the detail replaces the history entry rather than pushing the
  // list again, so the browser's Back does not reopen the detail just left.
  const closeIdentity = useCallback(
    () =>
      setRoute(
        route.view === "identities" && route.returnOrganizationId
          ? {
              view: "organizations",
              organizationId: route.returnOrganizationId,
              tab: "identities",
            }
          : IDENTITIES_ROOT_ROUTE,
        { replace: true },
      ),
    [route, setRoute],
  );

  const openOrganization = useCallback(
    (organizationId: string) =>
      setRoute({ view: "organizations", organizationId }),
    [setRoute],
  );
  const closeOrganization = useCallback(
    () =>
      setRoute(
        route.view === "organizations" && route.returnView === "reports"
          ? { view: "reports" }
          : ORGANIZATIONS_ROOT_ROUTE,
        { replace: true },
      ),
    [route, setRoute],
  );

  return {
    setView,
    openIdentity,
    closeIdentity,
    openOrganization,
    closeOrganization,
  };
}
