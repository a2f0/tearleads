import type { MiniAppRouteSetOptions } from "@tearleads/windowing";
import { useCallback } from "react";
import {
  IDENTITIES_ROOT_ROUTE,
  ORGANIZATIONS_ROOT_ROUTE,
  type RootReturn,
  type RootRoute,
  type RootView,
  rootRouteForView,
} from "./routes";

/**
 * The return a detail opened from `route` carries, so Back comes back here. A
 * detail opened from another detail passes that one's return along, so a walk
 * that started in the audit trail or Reports still ends back there.
 */
function returnTo(route: RootRoute): RootReturn {
  if (route.view === "audit")
    return {
      returnView: "audit",
      ...(route.subjectId ? { returnSubjectId: route.subjectId } : {}),
    };
  if (
    (route.view !== "organizations" && route.view !== "identities") ||
    !route.returnView
  )
    return {};
  return {
    returnView: route.returnView,
    ...(route.returnSubjectId
      ? { returnSubjectId: route.returnSubjectId }
      : {}),
  };
}

function routeForReturn(
  { returnSubjectId, returnView }: RootReturn,
  fallback: RootRoute,
): RootRoute {
  if (returnView === "reports") return { view: "reports" };
  if (returnView === "audit")
    return { subjectId: returnSubjectId ?? null, view: "audit" };
  return fallback;
}

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
        ...returnTo(route),
      }),
    [route, setRoute],
  );
  // Leaving the detail replaces the history entry rather than pushing the
  // list again, so the browser's Back does not reopen the detail just left.
  const closeIdentity = useCallback(
    () =>
      setRoute(
        route.view !== "identities"
          ? IDENTITIES_ROOT_ROUTE
          : route.returnOrganizationId
            ? {
                view: "organizations",
                organizationId: route.returnOrganizationId,
                tab: "identities",
                ...(route.returnView ? { returnView: route.returnView } : {}),
                ...(route.returnSubjectId
                  ? { returnSubjectId: route.returnSubjectId }
                  : {}),
              }
            : routeForReturn(route, IDENTITIES_ROOT_ROUTE),
        { replace: true },
      ),
    [route, setRoute],
  );

  const openOrganization = useCallback(
    (organizationId: string) =>
      setRoute({
        view: "organizations",
        organizationId,
        ...returnTo(route),
      }),
    [route, setRoute],
  );
  const closeOrganization = useCallback(
    () =>
      setRoute(
        route.view === "organizations"
          ? routeForReturn(route, ORGANIZATIONS_ROOT_ROUTE)
          : ORGANIZATIONS_ROOT_ROUTE,
        { replace: true },
      ),
    [route, setRoute],
  );

  const openAudit = useCallback(
    (subjectId: string) => setRoute({ subjectId, view: "audit" }),
    [setRoute],
  );

  return {
    openAudit,
    setView,
    openIdentity,
    closeIdentity,
    openOrganization,
    closeOrganization,
  };
}
