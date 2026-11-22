import type { MiniAppRouteSetOptions } from "@tearleads/windowing";
import { useCallback } from "react";
import {
  IDENTITIES_ROOT_ROUTE,
  ORGANIZATIONS_ROOT_ROUTE,
  REPORTS_ROOT_ROUTE,
  type RootOrganizationTab,
  type RootReportId,
  type RootReturn,
  type RootRoute,
  type RootView,
  rootRouteForView,
} from "./routes";

/** The return fields a detail route already carries, without empty ones. */
function carriedReturn({
  returnReportId,
  returnSubjectId,
  returnView,
}: RootReturn): RootReturn {
  if (!returnView) return {};
  return {
    returnView,
    ...(returnReportId ? { returnReportId } : {}),
    ...(returnSubjectId ? { returnSubjectId } : {}),
  };
}

/**
 * The return a detail opened from `route` carries, so Back comes back here. A
 * detail opened from another detail passes that one's return along, so a walk
 * that started in the audit trail or a report still ends back there.
 */
function returnTo(route: RootRoute): RootReturn {
  if (route.view === "reports")
    return carriedReturn({
      returnView: "reports",
      ...(route.reportId ? { returnReportId: route.reportId } : {}),
    });
  if (route.view === "audit")
    return carriedReturn({
      returnView: "audit",
      ...(route.subjectId ? { returnSubjectId: route.subjectId } : {}),
    });
  if (route.view === "organizations" || route.view === "identities")
    return carriedReturn(route);
  return {};
}

function routeForReturn(
  { returnReportId, returnSubjectId, returnView }: RootReturn,
  fallback: RootRoute,
): RootRoute {
  if (returnView === "reports")
    return { reportId: returnReportId ?? null, view: "reports" };
  if (returnView === "audit")
    return { subjectId: returnSubjectId ?? null, view: "audit" };
  return fallback;
}

/**
 * Where leaving the detail `route` shows leads, or null when `route` is a
 * top-level list. Leaving replaces the detail's history entry rather than
 * pushing the list again, so a later Back does not reopen the detail just
 * left.
 */
export function rootDetailParentRoute(route: RootRoute): RootRoute | null {
  if (route.view === "reports")
    return route.reportId === null ? null : REPORTS_ROOT_ROUTE;
  if (route.view === "organizations")
    return route.organizationId === null
      ? null
      : routeForReturn(route, ORGANIZATIONS_ROOT_ROUTE);
  if (route.view !== "identities" || route.userId === null) return null;
  if (!route.returnOrganizationId)
    return routeForReturn(route, IDENTITIES_ROOT_ROUTE);
  return {
    view: "organizations",
    organizationId: route.returnOrganizationId,
    tab: route.returnOrganizationTab ?? "identities",
    ...carriedReturn(route),
  };
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
          ? {
              returnOrganizationId: route.organizationId,
              returnOrganizationTab: route.tab ?? "overview",
            }
          : {}),
        ...returnTo(route),
      }),
    [route, setRoute],
  );
  const openOrganization = useCallback(
    (organizationId: string, tab?: RootOrganizationTab) =>
      setRoute({
        view: "organizations",
        organizationId,
        ...(tab ? { tab } : {}),
        ...returnTo(route),
      }),
    [route, setRoute],
  );
  const openReport = useCallback(
    (reportId: RootReportId) => setRoute({ reportId, view: "reports" }),
    [setRoute],
  );
  const openAudit = useCallback(
    (subjectId: string) => setRoute({ subjectId, view: "audit" }),
    [setRoute],
  );

  return {
    openAudit,
    openIdentity,
    openOrganization,
    openReport,
    setView,
  };
}
