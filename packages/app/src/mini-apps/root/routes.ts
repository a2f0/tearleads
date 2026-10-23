export const ROOT_ORGANIZATION_TABS = [
  { id: "overview", label: "Overview" },
  { id: "billing", label: "Billing" },
  { id: "history", label: "History" },
  { id: "identities", label: "Identities" },
  { id: "data-usage", label: "Data Usage" },
] as const;
export type RootOrganizationTab = (typeof ROOT_ORGANIZATION_TABS)[number]["id"];
export type RootView =
  | "menu"
  | "identities"
  | "organizations"
  | "reports"
  | "audit";
export type RootRoute =
  | { readonly view: "menu" }
  | { readonly view: "reports" }
  | { readonly subjectId: string | null; readonly view: "audit" }
  | ({
      readonly userId: string | null;
      readonly view: "identities";
      readonly returnOrganizationId?: string;
    } & RootReturn)
  | ({
      readonly organizationId: string | null;
      readonly view: "organizations";
      readonly tab?: RootOrganizationTab;
    } & RootReturn);
/**
 * Where a detail view's Back leads: the Reports list, or the audit trail with
 * the subject it was filtered to.
 */
export interface RootReturn {
  readonly returnView?: "reports" | "audit";
  readonly returnSubjectId?: string;
}
export const MENU_ROOT_ROUTE: RootRoute = { view: "menu" };
export const IDENTITIES_ROOT_ROUTE: RootRoute = {
  userId: null,
  view: "identities",
};
export const ORGANIZATIONS_ROOT_ROUTE: RootRoute = {
  organizationId: null,
  view: "organizations",
};
const AUDIT_ROOT_ROUTE: RootRoute = { subjectId: null, view: "audit" };

function parseRootReturn(
  segments: ReadonlyArray<string>,
  allowReports: boolean,
): RootReturn {
  const [returnView, returnSubjectId] = segments;
  if (returnView === "reports" && allowReports) return { returnView };
  if (returnView !== "audit") return {};
  return { returnView, ...(returnSubjectId ? { returnSubjectId } : {}) };
}
function formatRootReturn(route: RootReturn): ReadonlyArray<string> {
  if (route.returnView !== "audit") return route.returnView ? ["reports"] : [];
  return route.returnSubjectId ? ["audit", route.returnSubjectId] : ["audit"];
}

export function parseRootRouteSegments(
  pathSegments: ReadonlyArray<string>,
): RootRoute {
  const [view, id, ...rest] = pathSegments;
  if (view === "identities") {
    const [returnView, returnId, ...returnTail] = rest;
    if (!id) return { userId: null, view };
    return returnView === "organizations" && returnId
      ? {
          userId: id,
          view,
          returnOrganizationId: returnId,
          ...parseRootReturn(returnTail, true),
        }
      : { userId: id, view, ...parseRootReturn(rest, false) };
  }
  if (view === "reports") return { view };
  if (view === "audit") return { subjectId: id || null, view };
  if (view === "organizations") {
    const [tabId, ...returnTail] = rest;
    const tab = ROOT_ORGANIZATION_TABS.find((tab) => tab.id === tabId)?.id;
    if (!id) return { organizationId: null, view };
    return {
      organizationId: id,
      view,
      ...(tab ? { tab } : {}),
      ...parseRootReturn(returnTail, true),
    };
  }
  return MENU_ROOT_ROUTE;
}
export function formatRootRouteSegments(
  route: RootRoute,
): ReadonlyArray<string> {
  if (route.view === "menu") return [];
  if (route.view === "reports") return [route.view];
  if (route.view === "audit")
    return route.subjectId === null
      ? [route.view]
      : [route.view, route.subjectId];
  if (route.view === "organizations")
    return route.organizationId === null
      ? [route.view]
      : [
          route.view,
          route.organizationId,
          ...(route.tab || route.returnView ? [route.tab ?? "overview"] : []),
          ...formatRootReturn(route),
        ];
  if (route.userId === null) return [route.view];
  return [
    route.view,
    route.userId,
    ...(route.returnOrganizationId
      ? ["organizations", route.returnOrganizationId]
      : []),
    ...(route.returnOrganizationId || route.returnView === "audit"
      ? formatRootReturn(route)
      : []),
  ];
}
export function rootRouteForView(view: RootView): RootRoute {
  if (view === "reports") return { view };
  if (view === "audit") return AUDIT_ROOT_ROUTE;
  if (view === "organizations") return ORGANIZATIONS_ROOT_ROUTE;
  return view === "identities" ? IDENTITIES_ROOT_ROUTE : MENU_ROOT_ROUTE;
}
